import { ForbiddenException, Injectable, InternalServerErrorException, UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { ApplyLogoDto } from './dto/apply-logo.dto';
import { ImgbbService } from '../lib/imgbb/imgbb.service';
import { JwtLibService } from '../lib/jwt/jwt.service';
import { RedisService } from '../common/redis/redis.service';

const CANVAS = 500;
const MARGIN = 16;
const DOWNLOAD_TOKEN_TTL_SECONDS = 30 * 60;
const DOWNLOAD_TOKEN_PURPOSE = 'render-download';

type Position = 'tl' | 'tr' | 'bl' | 'br';

const BADGE_STYLE_FILL: Record<string, { fill: string; border?: { color: string; width: number } }> = {
  glass: { fill: 'primary28', border: { color: 'primary50', width: 1 } },
  solid: { fill: 'primary100' },
  outline: { fill: 'black28', border: { color: 'primary100', width: 2 } },
  minimal: { fill: 'none' },
};

@Injectable()
export class ApplyLogoService {
  constructor(
    private readonly imgbbService: ImgbbService,
    private readonly jwtLibService: JwtLibService,
    private readonly redisService: RedisService
  ) {}

  async apply(dto: ApplyLogoDto): Promise<{
    renderId: string;
    downloadToken: string;
    expiresIn: number;
    previewUrl: string;
    downloadUrl: string;
    width: number;
    height: number;
    createdAt: string;
  }> {
    const templateBuf = await this.fetchAsBuffer(dto.templateImageUrl);

    const wantsLogo = dto.showBadge && dto.showLogo && !!dto.logoUrl;
    const logoBuf = wantsLogo ? await this.fetchAsBuffer(dto.logoUrl as string) : null;

    let background: Buffer;
    try {
      background = await sharp(templateBuf)
        .resize(CANVAS, CANVAS, { fit: 'cover', position: 'center' })
        .toBuffer();
    } catch (error) {
      throw new InternalServerErrorException('Render failed');
    }

    try {
      const layers: sharp.OverlayOptions[] = [];

      const badge = this.computeBadge(dto);

      if (dto.blur > 0 && badge && (dto.badgeStyle === 'glass' || dto.badgeStyle === 'outline')) {
        const backdropPatch = await sharp(background)
          .extract({ left: badge.x, top: badge.y, width: badge.width, height: badge.height })
          .blur(dto.blur)
          .toBuffer();
        layers.push({ input: backdropPatch, left: badge.x, top: badge.y });
      }

      let logoDataUri: string | null = null;
      if (logoBuf && badge) {
        const rounded = await this.roundedSquareLogo(logoBuf, dto.logoSize);
        logoDataUri = `data:image/png;base64,${rounded.toString('base64')}`;
      }

      const svg = this.buildOverlaySvg(dto, badge, logoDataUri);
      layers.push({ input: Buffer.from(svg), left: 0, top: 0 });

      const outputBuffer = await sharp(background).composite(layers).png().toBuffer();

      const { imageUrl } = await this.imgbbService.uploadBuffer(outputBuffer);

      const renderId = randomUUID();
      await this.redisService
        .getClient()
        .set(this.renderKey(renderId), imageUrl, { EX: DOWNLOAD_TOKEN_TTL_SECONDS });

      const downloadToken = this.jwtLibService.sign(
        { purpose: DOWNLOAD_TOKEN_PURPOSE, renderId },
        { expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS }
      );

      return {
        renderId,
        downloadToken,
        expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
        previewUrl: `/api/templates/render/${renderId}?token=${downloadToken}`,
        downloadUrl: `/api/templates/render/${renderId}/download?token=${downloadToken}`,
        width: CANVAS,
        height: CANVAS,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('apply-logo render error:', error);
      throw new InternalServerErrorException('Render failed');
    }
  }

  async streamRender(renderId: string, token: string, asAttachment: boolean, res: Response): Promise<void> {
    if (!token) throw new ForbiddenException('Missing token');

    let payload: { purpose?: string; renderId?: string };
    try {
      payload = this.jwtLibService.verify(token);
    } catch {
      throw new ForbiddenException('Invalid or expired token');
    }

    if (payload.purpose !== DOWNLOAD_TOKEN_PURPOSE || payload.renderId !== renderId) {
      throw new ForbiddenException('Token does not match this render');
    }

    const imageUrl = await this.redisService.getClient().get(this.renderKey(renderId));
    if (!imageUrl) throw new ForbiddenException('Render expired or not found');

    const buffer = await this.fetchAsBuffer(imageUrl);

    res.setHeader('Content-Type', 'image/png');
    if (asAttachment) {
      res.setHeader('Content-Disposition', `attachment; filename="${renderId}.png"`);
    }
    res.send(buffer);
  }

  private renderKey(renderId: string): string {
    return `render:download:${renderId}`;
  }

  private async fetchAsBuffer(url: string): Promise<Buffer> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch {
      throw new UnprocessableEntityException('Could not fetch logoUrl or templateImageUrl');
    }
  }

  private async roundedSquareLogo(buf: Buffer, size: number): Promise<Buffer> {
    const resized = await sharp(buf).resize(size, size, { fit: 'cover' }).toBuffer();
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="6" ry="6" fill="white"/></svg>`
    );
    return sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }

  private computeBadge(dto: ApplyLogoDto): { x: number; y: number; width: number; height: number; textStartX: number; textTopY: number; lines: { text: string; fontSize: number; fontWeight: number }[]; logoBoxSize: number } | null {
    const showLogoBox = dto.showLogo && !!dto.logoUrl;
    const lines: { text: string; fontSize: number; fontWeight: number }[] = [];
    if (dto.showName && dto.brandName) lines.push({ text: dto.brandName, fontSize: 15, fontWeight: 800 });
    if (dto.showContact && dto.phone) lines.push({ text: dto.phone, fontSize: 12, fontWeight: 600 });
    if (dto.showOvtext && dto.overlayText) lines.push({ text: dto.overlayText, fontSize: 12, fontWeight: 500 });

    if (!dto.showBadge || (!showLogoBox && lines.length === 0)) return null;

    const paddingX = 14;
    const paddingY = 10;
    const gap = 10;
    const lineHeight = 17;

    const textBlockWidth = lines.reduce((max, l) => Math.max(max, this.estimateTextWidth(l.text, l.fontSize, l.fontWeight)), 0);
    const textBlockHeight = lines.length * lineHeight;

    const contentWidth = (showLogoBox ? dto.logoSize + gap : 0) + textBlockWidth;
    const contentHeight = Math.max(showLogoBox ? dto.logoSize : 0, textBlockHeight);

    const width = Math.round(Math.min(260, contentWidth + paddingX * 2));
    const height = Math.round(contentHeight + paddingY * 2);

    let x: number;
    let y: number;
    switch (dto.position as Position) {
      case 'tr':
        x = CANVAS - MARGIN - width;
        y = MARGIN;
        break;
      case 'bl':
        x = MARGIN;
        y = CANVAS - MARGIN - height;
        break;
      case 'br':
        x = CANVAS - MARGIN - width;
        y = CANVAS - MARGIN - height;
        break;
      case 'tl':
      default:
        x = MARGIN;
        y = MARGIN;
        break;
    }

    const textStartX = x + paddingX + (showLogoBox ? dto.logoSize + gap : 0);
    const textTopY = y + (height - textBlockHeight) / 2;

    return { x, y, width, height, textStartX, textTopY, lines, logoBoxSize: showLogoBox ? dto.logoSize : 0 };
  }

  private buildOverlaySvg(
    dto: ApplyLogoDto,
    badge: ReturnType<ApplyLogoService['computeBadge']>,
    logoDataUri: string | null
  ): string {
    const parts: string[] = [`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">`];

    if (dto.showTextbar) {
      parts.push(this.buildBottomBar(dto));
    }

    if (dto.showCorner) {
      parts.push(this.buildCornerAccent(dto));
    }

    if (badge) {
      parts.push(this.buildBadge(dto, badge, logoDataUri));
    }

    parts.push('</svg>');
    return parts.join('');
  }

  private buildBottomBar(dto: ApplyLogoDto): string {
    const barTop = CANVAS * 0.78;
    const barHeight = CANVAS * 0.22;
    const text = [dto.showName ? dto.brandName : '', dto.showContact ? dto.phone : '', dto.showOvtext ? dto.overlayText : '']
      .filter((t) => !!t && t.trim().length > 0)
      .join('  ·  ');

    if (!text) {
      return `
        <defs>
          <linearGradient id="bottomBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${dto.primaryColor}" stop-opacity="0"/>
            <stop offset="100%" stop-color="${dto.primaryColor}" stop-opacity="0.7"/>
          </linearGradient>
        </defs>
        <rect x="0" y="${barTop}" width="${CANVAS}" height="${barHeight}" fill="url(#bottomBarGrad)"/>`;
    }

    return `
      <defs>
        <linearGradient id="bottomBarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${dto.primaryColor}" stop-opacity="0"/>
          <stop offset="100%" stop-color="${dto.primaryColor}" stop-opacity="0.7"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${barTop}" width="${CANVAS}" height="${barHeight}" fill="url(#bottomBarGrad)"/>
      <text x="${CANVAS / 2}" y="${CANVAS - 18}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="#ffffff" text-anchor="middle">${this.escapeXml(text)}</text>`;
  }

  private buildCornerAccent(dto: ApplyLogoDto): string {
    const size = 44;
    const strokeWidth = 4;
    let path: string;
    switch (dto.position as Position) {
      case 'tr':
        path = `M ${CANVAS - MARGIN - size} ${MARGIN} L ${CANVAS - MARGIN} ${MARGIN} L ${CANVAS - MARGIN} ${MARGIN + size}`;
        break;
      case 'bl':
        path = `M ${MARGIN} ${CANVAS - MARGIN - size} L ${MARGIN} ${CANVAS - MARGIN} L ${MARGIN + size} ${CANVAS - MARGIN}`;
        break;
      case 'br':
        path = `M ${CANVAS - MARGIN - size} ${CANVAS - MARGIN} L ${CANVAS - MARGIN} ${CANVAS - MARGIN} L ${CANVAS - MARGIN} ${CANVAS - MARGIN - size}`;
        break;
      case 'tl':
      default:
        path = `M ${MARGIN} ${MARGIN + size} L ${MARGIN} ${MARGIN} L ${MARGIN + size} ${MARGIN}`;
        break;
    }
    return `<path d="${path}" fill="none" stroke="${dto.primaryColor}" stroke-width="${strokeWidth}" stroke-linecap="square"/>`;
  }

  private buildBadge(dto: ApplyLogoDto, badge: NonNullable<ReturnType<ApplyLogoService['computeBadge']>>, logoDataUri: string | null): string {
    const style = BADGE_STYLE_FILL[dto.badgeStyle];
    const fill = this.resolveBadgeColor(style.fill, dto.primaryColor);
    const border = style.border
      ? `stroke="${this.resolveBadgeColor(style.border.color, dto.primaryColor)}" stroke-width="${style.border.width}"`
      : '';

    const textColor = dto.textColor === 'white' ? '#ffffff' : '#0D0E1A';
    const opacity = dto.opacity / 100;

    const rectFill = fill === 'none' ? 'fill="none"' : `fill="${fill}"`;

    let logoImage = '';
    if (logoDataUri && badge.logoBoxSize > 0) {
      const logoY = badge.y + (badge.height - badge.logoBoxSize) / 2;
      const logoX = badge.x + 14;
      logoImage = `<image x="${logoX}" y="${logoY}" width="${badge.logoBoxSize}" height="${badge.logoBoxSize}" href="${logoDataUri}"/>`;
    }

    const lineHeight = 17;
    const textLines = badge.lines
      .map((line, i) => {
        const y = badge.textTopY + i * lineHeight + 13;
        return `<text x="${badge.textStartX}" y="${y}" font-family="Inter, system-ui, sans-serif" font-size="${line.fontSize}" font-weight="${line.fontWeight}" fill="${textColor}">${this.escapeXml(line.text)}</text>`;
      })
      .join('');

    return `
      <g opacity="${opacity}">
        <rect x="${badge.x}" y="${badge.y}" width="${badge.width}" height="${badge.height}" rx="${dto.radius}" ry="${dto.radius}" ${rectFill} ${border}/>
        ${logoImage}
        ${textLines}
      </g>`;
  }

  private resolveBadgeColor(token: string, primaryColor: string): string {
    switch (token) {
      case 'primary28':
        return this.hexToRgba(primaryColor, 0.28);
      case 'primary50':
        return this.hexToRgba(primaryColor, 0.5);
      case 'primary100':
        return primaryColor;
      case 'black28':
        return 'rgba(0,0,0,0.28)';
      case 'none':
        return 'none';
      default:
        return token;
    }
  }

  private hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  private estimateTextWidth(text: string, fontSize: number, fontWeight = 500): number {
    const weightFactor = fontWeight >= 700 ? 0.66 : fontWeight >= 600 ? 0.6 : 0.55;
    return text.length * fontSize * weightFactor;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
