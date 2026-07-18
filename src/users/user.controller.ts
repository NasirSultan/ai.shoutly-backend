import { Body, Controller, Delete, Get,UseGuards, Param, Patch, Post,Query,Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { SelectSubIndustryDto } from './dto/select-sub-industry.dto';
import { Express } from 'express'
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Get()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: 'active' | 'suspended',
  ) {
    return this.userService.findAllForAdmin({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      search: search?.trim() || undefined,
      role,
      status,
    });
  }

    @Patch('profile-update')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadProfilePhoto(@Req() req, @UploadedFile() file: Express.Multer.File) {
    const userId = req.user.id;
    console.log('Received file:', userId);
    return this.userService.updateProfilePhoto(userId, file);
  }
  @Patch('password')
  @UseGuards(AuthGuard)
  updatePassword(@Req() req, @Body() dto: UpdatePasswordDto) {
    const userId = req.user.id;
    return this.userService.updatePassword(userId, dto);
  }

  @Get('me/industry-selection')
  @UseGuards(AuthGuard)
  getIndustrySelection(@Req() req) {
    return this.userService.getIndustrySelection(req.user.id);
  }

  @Patch('me/industry-selection')
  @UseGuards(AuthGuard)
  selectSubIndustry(@Req() req, @Body() dto: SelectSubIndustryDto) {
    return this.userService.selectSubIndustry(req.user.id, dto.subIndustryId);
  }

  @Get(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findOne(@Param('id') id: string) {
    return this.userService.findOneForAdmin(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req) {
    return this.userService.update(id, dto, { id: req.user.id, email: req.user.email }, req.ip);
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @Req() req) {
    return this.userService.updateStatus(id, dto.isActive, { id: req.user.id, email: req.user.email }, req.ip);
  }

  @Delete(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  remove(@Param('id') id: string, @Req() req) {
    return this.userService.remove(id, { id: req.user.id, email: req.user.email }, req.ip);
  }
}