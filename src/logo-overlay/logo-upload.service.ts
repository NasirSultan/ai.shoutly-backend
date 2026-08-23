import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { ImgbbService } from '../lib/imgbb/imgbb.service';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Injectable()
export class LogoUploadService {
  constructor(private readonly imgbbService: ImgbbService) {}

  async upload(file: Express.Multer.File): Promise<{ logoId: string; logoUrl: string; width: number; height: number }> {
    if (!file) throw new BadRequestException('No file provided');

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Unsupported file type. Use PNG, JPG, SVG, or WEBP.');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException('File too large. Max 5MB.');
    }

    let width = 0;
    let height = 0;
    try {
      const metadata = await sharp(file.buffer).metadata();
      width = metadata.width || 0;
      height = metadata.height || 0;
    } catch {
      // dimensions unavailable (e.g. some SVGs) — not fatal
    }

    const { imageUrl } = await this.imgbbService.uploadBuffer(file.buffer);

    return {
      logoId: randomUUID(),
      logoUrl: imageUrl,
      width,
      height,
    };
  }
}
