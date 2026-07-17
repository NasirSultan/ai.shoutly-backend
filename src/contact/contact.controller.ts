import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ContactService } from './contact.service'
import { CreateContactDto } from './dto/create-contact.dto'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.contactService.create(dto)
  }

  @Get()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findAll() {
    return this.contactService.findAll()
  }

  @Get(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id)
  }

  @Patch(':id/toggle-status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  toggleStatus(@Param('id') id: string) {
    return this.contactService.toggleStatus(id)
  }

  @Delete(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  remove(@Param('id') id: string) {
    return this.contactService.remove(id)
  }
}
