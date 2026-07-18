import { Injectable, NotFoundException, BadRequestException,InternalServerErrorException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ImgbbService } from '../lib/imgbb/imgbb.service';
import { Express } from 'express';
import { UpdatePasswordDto } from './dto/update-password.dto';
import * as bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { AuditLogService, AuditActor } from '../audit-log/audit-log.service';
@Injectable()
export class UserService {
  private prisma = prisma;

  constructor(
    private readonly imgbbService: ImgbbService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Fields safe to return to the admin panel — excludes password/otp/refreshToken.
  private readonly adminSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    file: true,
    brandName: true,
    brandLogo: true,
    website: true,
    role: true,
    isActive: true,
    connectedSocials: true,
    jobTitle: true,
    industryId: true,
    industry: { select: { id: true, name: true } },
    subIndustryId: true,
    subIndustry: { select: { id: true, name: true } },
    timezone: true,
    language: true,
    logo: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto, select: this.adminSelect });
  }

  async findAllForAdmin(opts: {
    page: number;
    limit: number;
    search?: string;
    role?: string;
    status?: 'active' | 'suspended';
  }) {
    const { page, limit, search, role, status } = opts;
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;
    if (status === 'active') where.isActive = true;
    if (status === 'suspended') where.isActive = false;

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: this.adminSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOneForAdmin(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: this.adminSelect });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateStatus(id: string, isActive: boolean, actor: AuditActor, ip?: string) {
    const before = await this.findOne(id);
    const updated = await this.prisma.user.update({ where: { id }, data: { isActive }, select: this.adminSelect });

    this.auditLogService.log({
      actor,
      action: 'USER_STATUS_CHANGED',
      targetType: 'User',
      targetId: id,
      before: { isActive: before.isActive },
      after: { isActive: updated.isActive },
      ip,
    });

    return updated;
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

    await this.prisma.user.update({
      where: { id: userId },
      data: { subIndustryId: subIndustry.id, industryId: subIndustry.industryId }
    });

    return { industry: subIndustry.industry, subIndustry: { ...subIndustry, industry: undefined } };
  }

  async update(id: string, dto: UpdateUserDto, actor: AuditActor, ip?: string) {
    const before = await this.findOne(id);
    const updated = await this.prisma.user.update({ where: { id }, data: dto, select: this.adminSelect });

    if (dto.role !== undefined && dto.role !== before.role) {
      this.auditLogService.log({
        actor,
        action: 'USER_ROLE_CHANGED',
        targetType: 'User',
        targetId: id,
        before: { role: before.role },
        after: { role: updated.role },
        ip,
      });
    }

    return updated;
  }

  async remove(id: string, actor: AuditActor, ip?: string) {
    const user = await this.findOne(id);
    if (user.deleteFileUrl) {
      await this.imgbbService.deleteFile(user.deleteFileUrl);
    }
    await this.prisma.user.delete({ where: { id } });

    this.auditLogService.log({
      actor,
      action: 'USER_DELETED',
      targetType: 'User',
      targetId: id,
      before: { id: user.id, name: user.name, email: user.email, role: user.role },
      after: null,
      ip,
    });

    return { success: true, id };
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