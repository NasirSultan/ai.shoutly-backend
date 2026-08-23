import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { LogoUploadService } from './logo-upload.service';

@Controller('logo')
export class LogoUploadController {
  constructor(private readonly logoUploadService: LogoUploadService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return this.logoUploadService.upload(file);
  }
}
