import { Body, Controller, Delete, Get,UseGuards, Param, Patch, Post,Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { SelectSubIndustryDto } from './dto/select-sub-industry.dto';
import { Express } from 'express'
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Get()
  findAll() {
    return this.userService.findAll();
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
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }


  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}