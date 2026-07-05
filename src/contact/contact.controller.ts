import { Controller, Post, Get, Patch, Delete, Body, Param } from '@nestjs/common'
import { ContactService } from './contact.service'
import { CreateContactDto } from './dto/create-contact.dto'

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.contactService.create(dto)
  }

  @Get()
  findAll() {
    return this.contactService.findAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id)
  }

  @Patch(':id/toggle-status')
  toggleStatus(@Param('id') id: string) {
    return this.contactService.toggleStatus(id)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contactService.remove(id)
  }
}
