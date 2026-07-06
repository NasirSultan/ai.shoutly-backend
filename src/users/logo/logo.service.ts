import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { CreateLogoDto } from './dto/create-logo.dto';
import { UpdateLogoDto } from './dto/update-logo.dto';
import axios from 'axios';
import FormData from 'form-data';
import { Express } from 'express';
import { prisma } from '../../lib/prisma';

@Injectable()
export class LogoService {
  private prisma = prisma;
  private imgbbKey = process.env.IMGBB_KEY;

  private async uploadToImgbb(file: Express.Multer.File): Promise<string> {
    try {
      const form = new FormData();
      form.append('image', file.buffer.toString('base64'));

      const response = await axios.post(
        `https://api.imgbb.com/1/upload?key=${this.imgbbKey}`,
        form,
        { headers: form.getHeaders() }
      );

      if (!response.data?.data?.url) {
        throw new InternalServerErrorException('Failed to upload image to Imgbb');
      }

      return response.data.data.url;
    } catch (error) {
      throw new InternalServerErrorException('Image upload failed');
    }
  }

  async create(userId: string, dto: CreateLogoDto, file: Express.Multer.File) {
    if (!userId) throw new BadRequestException('Invalid user');

    try {
      const existingLogo = await this.prisma.logo.findUnique({ where: { userId } });
      if (existingLogo) throw new BadRequestException('User already has a logo');

      const imageUrl = await this.uploadToImgbb(file);

      return await this.prisma.logo.create({
        data: {
          ...dto,
          file: imageUrl,
          userId,
        },
        include: { user: true }, // optional, include user data if needed
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to create logo');
    }
  }

  async findOne(userId: string) {
    if (!userId) throw new BadRequestException('Invalid user');

    try {
      const logo = await this.prisma.logo.findUnique({
        where: { userId }, // include related user info
      });
      if (!logo) throw new NotFoundException('Logo not found');
      return logo;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to fetch logo');
    }
  }

  async update(userId: string, dto: UpdateLogoDto, file?: Express.Multer.File) {
    if (!userId) throw new BadRequestException('Invalid user');

    try {
      await this.findOne(userId);

      let imageUrl: string | undefined = undefined;
      if (file) imageUrl = await this.uploadToImgbb(file);

      return await this.prisma.logo.update({
        where: { userId },
        data: { ...dto, ...(imageUrl ? { file: imageUrl } : {}) },
        include: { user: true }, // optional
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to update logo');
    }
  }

  async remove(userId: string) {
    if (!userId) throw new BadRequestException('Invalid user');

    try {
      await this.findOne(userId);
      return await this.prisma.logo.delete({
        where: { userId },
        include: { user: true }, // optional
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete logo');
    }
  }
}
