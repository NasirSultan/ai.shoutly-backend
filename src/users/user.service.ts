import { Injectable, NotFoundException, BadRequestException,InternalServerErrorException, ConflictException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ImgbbService } from '../lib/imgbb/imgbb.service';
import { Express } from 'express';
import { UpdatePasswordDto } from './dto/update-password.dto';
import * as bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
@Injectable()
export class UserService {
  private prisma = prisma;

  constructor(private readonly imgbbService: ImgbbService) {}

  async create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto });
  }

  async findAll() {
    return this.prisma.user.findMany({ include: { logo: true } });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { logo: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getIndustrySelection(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { industry: true, subIndustry: { include: { industry: true } } }
    });
    if (!user) throw new NotFoundException('User not found');

    return { industry: user.industry, subIndustry: user.subIndustry };
  }

  async selectSubIndustry(userId: string, subIndustryId: string) {
    const subIndustry = await this.prisma.subIndustry.findUnique({
      where: { id: subIndustryId },
      include: { industry: true }
    });
    if (!subIndustry) throw new NotFoundException('Sub-industry not found');

    const claimedBy = await this.prisma.user.findUnique({ where: { subIndustryId } });
    if (claimedBy && claimedBy.id !== userId) {
      throw new ConflictException('This sub-industry is already assigned to another account');
    }

    const industryClaimedBy = await this.prisma.user.findUnique({ where: { industryId: subIndustry.industryId } });
    if (industryClaimedBy && industryClaimedBy.id !== userId) {
      throw new ConflictException('This industry is already assigned to another account');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { subIndustryId: subIndustry.id, industryId: subIndustry.industryId }
    });

    return { industry: subIndustry.industry, subIndustry: { ...subIndustry, industry: undefined } };
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const user = await this.findOne(id);
    if (user.deleteFileUrl) {
      await this.imgbbService.deleteFile(user.deleteFileUrl);
    }
    return this.prisma.user.delete({ where: { id } });
  }

  async updateProfilePhoto(id: string, file: Express.Multer.File) {
    const user = await this.findOne(id);

    if (user.deleteFileUrl) {
      await this.imgbbService.deleteFile(user.deleteFileUrl);
    }

    const { imageUrl, deleteUrl } = await this.imgbbService.uploadFile(file);

    return this.prisma.user.update({
      where: { id },
      data: {
        file: imageUrl,
        deleteFileUrl: deleteUrl
      }
    });
  }

 async updatePassword(userId: string, dto: UpdatePasswordDto) {
    if (!dto.currentPassword || !dto.newPassword) {
      throw new BadRequestException('Both current and new passwords are required');
    }

    const user = await this.findOne(userId);

    if (!user.password) {
      throw new BadRequestException('No password set for this user');
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
      select: {
        id: true,
        name: true,
        email: true,
        updatedAt: true
      }
    });
  }

}