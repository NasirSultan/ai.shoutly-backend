import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
const ImageKit = require('imagekit');
import fetch from 'node-fetch';
import sharp from 'sharp';
import { LayoutDto } from './layout.dto';

interface ImageData {
  id: string;
  file: string;
}

interface UploadResponse {
  url: string;
  [key: string]: any;
}

interface LogoData {
  id: string;
  file: string;
  size: string;
  position: string;
  color?: string;
  phone?: string;
  website?: string;
  userId: string;
}

@Injectable()
export class ImagelayoutService {
  private prisma: PrismaClient;
  private imagekit: any;

  constructor() {
    this.prisma = new PrismaClient();
    if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT) {
      this.imagekit = new ImageKit({
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
        privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
      });
    }
  }

  async createLayout(dto: LayoutDto): Promise<{ originalUrl: string; imageWithTextUrl: string }> {
    try {
      if (!dto.description) {
        throw new BadRequestException('Description is required');
      }

      if (!dto.userId) {
        throw new BadRequestException('User ID is required');
      }

      // Fetch user's logo configuration
      const logoData: LogoData | null = await this.prisma.logo.findUnique({
        where: { userId: dto.userId }
      }) as LogoData | null;

      if (!logoData) {
        throw new NotFoundException('Logo configuration not found for this user');
      }

      // Use logo's color if provided, otherwise default to white
      const textColor = logoData.color || '#FFFFFF';
      const website = logoData.website || '';
      const phone = logoData.phone || '';

      // Fetch available images with proper typing
      const availableImages: ImageData[] = await this.prisma.image.findMany({
        where: { text: false },
        select: { id: true, file: true }
      }) as ImageData[];

      if (!availableImages.length) {
        throw new NotFoundException('No available images found');
      }

      const randomImage = availableImages[Math.floor(Math.random() * availableImages.length)];

      if (!randomImage.file || randomImage.file.trim() === '') {
        throw new BadRequestException('Image file is empty');
      }

      let imageUrl: string;

      if (randomImage.file.startsWith('http://') || randomImage.file.startsWith('https://')) {
        imageUrl = randomImage.file;
      } else {
        const baseUrl = process.env.IMAGEKIT_URL_ENDPOINT || 'http://localhost:3000';
        const filePath = randomImage.file.startsWith('/') ? randomImage.file : `/${randomImage.file}`;
        imageUrl = `${baseUrl}${filePath}`;
      }

      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new BadRequestException('Failed to fetch image');
      }
      const imageBuffer = await response.arrayBuffer();

      const image = sharp(Buffer.from(imageBuffer));
      const metadata = await image.metadata();
      const width = metadata.width || 800;
      const height = metadata.height || 600;

      // Dynamic logo sizing based on logo configuration
      const logoSizeMap: Record<string, number> = {
        SMALL: Math.floor(width / 8),
        MEDIUM: Math.floor(width / 6),
        LARGE: Math.floor(width / 4)
      };
      
      const logoSize = logoData.size ? logoSizeMap[logoData.size] : logoSizeMap.MEDIUM;
      const logoMargin = Math.floor(width / 40);

      // Calculate logo position based on logo configuration
      let logoX: number;
      const logoY = logoMargin; // Always at top
      
      switch (logoData.position) {
        case 'TOP_RIGHT':
          logoX = width - logoSize - logoMargin;
          break;
        case 'TOP_LEFT':
        default:
          logoX = logoMargin;
          break;
      }

      // Use logo from database (assuming file contains URL or path)
      let logoUrl: string;
      if (logoData.file.startsWith('http://') || logoData.file.startsWith('https://')) {
        logoUrl = logoData.file;
      } else {
        const baseUrl = process.env.IMAGEKIT_URL_ENDPOINT || 'http://localhost:3000';
        const filePath = logoData.file.startsWith('/') ? logoData.file : `/${logoData.file}`;
        logoUrl = `${baseUrl}${filePath}`;
      }

      const logoBuffer = await this.getCircleLogoBuffer(logoUrl, logoSize);

      // Create text overlay SVG with centered description
      const svgOverlay = this.createCenteredTextOverlay(
        width, 
        height, 
        dto.description, 
        website, 
        phone, 
        textColor,
        logoY + logoSize // Start text after logo
      );

      const outputBuffer = await sharp(Buffer.from(imageBuffer))
        .composite([
          { input: logoBuffer, top: logoY, left: logoX },
          { input: Buffer.from(svgOverlay), top: 0, left: 0 }
        ])
        .jpeg({ quality: 90 })
        .toBuffer();

      const uploadResponse: UploadResponse = await this.imagekit.upload({
        file: outputBuffer.toString('base64'),
        fileName: `layout-${Date.now()}.jpg`,
        folder: '/layouts',
        useUniqueFileName: true,
      });

      await this.markImageAsUsed(randomImage.id);

      return {
        originalUrl: imageUrl,
        imageWithTextUrl: uploadResponse.url
      };

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Layout creation error:', error);
      throw new BadRequestException('Failed to create layout: ' + (error as Error).message);
    }
  }

  private createCenteredTextOverlay(
    width: number, 
    height: number, 
    description: string, 
    website: string, 
    phone: string, 
    textColor: string = '#FFFFFF',
    startY: number = 100
  ): string {
    let svgContent = `<svg width="${width}" height="${height}">`;
    
    // Calculate optimal font size based on description length
    const descLength = description.length;
    let baseFontSize = Math.floor(Math.min(width, height) / 25); // Base size
    
    if (descLength > 300) {
      baseFontSize = Math.floor(Math.min(width, height) / 35);
    } else if (descLength > 150) {
      baseFontSize = Math.floor(Math.min(width, height) / 30);
    } else if (descLength < 50) {
      baseFontSize = Math.floor(Math.min(width, height) / 20);
    }
    
    // Wrap text into lines for vertical centering
    const maxLineWidth = width * 0.85; // 85% of width for text
    const lineHeight = baseFontSize * 1.4;
    
    const words = description.split(' ');
    let lines: string[] = [];
    let currentLine = words[0];
    
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + ' ' + word;
      const testWidth = this.estimateTextWidth(testLine, baseFontSize);
      
      if (testWidth <= maxLineWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    
    // Calculate vertical center position for description
    const totalTextHeight = lines.length * lineHeight;
    const verticalCenterY = Math.max(startY + (height - startY - totalTextHeight) / 2, startY + lineHeight);
    
    // Draw description lines centered
    lines.forEach((line, index) => {
      const yPos = verticalCenterY + (index * lineHeight);
      svgContent += `
        <text 
          x="50%" 
          y="${yPos}" 
          font-family="Arial, Helvetica, sans-serif" 
          font-size="${baseFontSize}" 
          fill="${textColor}" 
          text-anchor="middle"
          font-weight="500"
        >${this.escapeXml(line)}</text>`;
    });
    
    // Add contact info at bottom with fixed format and dynamic font sizing
    if (website || phone) {
      // Build contact info with fixed format - CORRECTED VERSION
      const contactParts: string[] = [];
      
      // CORRECTION: Use website value for "Web:" label
      if (website) contactParts.push(`Web: ${this.escapeXml(website)}`);
      
      // CORRECTION: Use phone value for "Phone:" label
      if (phone) contactParts.push(`Phone: ${this.escapeXml(phone)}`);
      
      const contactText = contactParts.join(' • ');
      
      // Calculate available width (with 80px padding on both sides)
      const paddingX = 40;
      const availableWidth = width - (paddingX * 2);
      
      // Start with base contact font size
      let contactFontSize = Math.floor(baseFontSize * 0.8);
      const minFontSize = Math.floor(Math.min(width, height) / 50); // Minimum font size
      
      // Calculate text width
      let contactTextWidth = this.estimateTextWidth(contactText, contactFontSize);
      
      // Reduce font size if text is too wide for available space
      while (contactTextWidth > availableWidth && contactFontSize > minFontSize) {
        contactFontSize -= 1;
        contactTextWidth = this.estimateTextWidth(contactText, contactFontSize);
      }
      
      // Calculate Y position with padding
      const paddingY = 30;
      const contactY = height - paddingY;
      
      // Draw contact info centered with padding
      svgContent += `
        <text 
          x="50%" 
          y="${contactY}" 
          font-family="Arial, Helvetica, sans-serif" 
          font-size="${contactFontSize}" 
          fill="${textColor}" 
          text-anchor="middle"
          font-weight="400"
        >
          <tspan x="50%" dy="0">${contactText}</tspan>
        </text>`;
    }
    
    svgContent += '</svg>';
    return svgContent;
  }

  private getContrastColor(textColor: string): string {
    // If text color is light, return dark shadow, else light shadow
    const hex = textColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate brightness
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    
    return brightness > 128 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';
  }

  private estimateTextWidth(text: string, fontSize: number): number {
    // More accurate estimation for different characters
    const avgCharWidth = fontSize * 0.55; // Slightly smaller for better fit
    return text.length * avgCharWidth;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async markImageAsUsed(imageId: string): Promise<void> {
    try {
      await this.prisma.image.update({
        where: { id: imageId },
        data: { text: true }
      });
    } catch (error) {
      console.error('Failed to update image:', error);
    }
  }

  private async getCircleLogoBuffer(url: string, size: number): Promise<Buffer> {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const resized = await sharp(buf).resize(size, size).toBuffer();
    const circle = Buffer.from(
      `<svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
      </svg>`
    );
    const masked = await sharp(resized).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
    return masked;
  }
}