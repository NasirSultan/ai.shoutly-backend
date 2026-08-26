import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { TemplateUploadService } from './template-upload.service';

@Controller('templates')
export class TemplateUploadController {
  constructor(private readonly templateUploadService: TemplateUploadService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return this.templateUploadService.upload(file);
  }
}
