import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { CreateContactDto } from './dto/create-contact.dto'

const prisma = new PrismaClient()

@Injectable()
export class ContactService {
  async create(dto: CreateContactDto) {
    return prisma.contactForm.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        query: dto.query,
      },
    })
  }

  async findAll() {
    return prisma.contactForm.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    const contact = await prisma.contactForm.findUnique({ where: { id } })
    if (!contact) throw new NotFoundException(`Contact ${id} not found`)
    return contact
  }

  async toggleStatus(id: string) {
    const contact = await prisma.contactForm.findUnique({ where: { id } })
    if (!contact) throw new NotFoundException(`Contact ${id} not found`)

    const newStatus = contact.status === 'PENDING' ? 'DONE' : 'PENDING'

    return prisma.contactForm.update({
      where: { id },
      data: { status: newStatus },
    })
  }

  async remove(id: string) {
    const contact = await prisma.contactForm.findUnique({ where: { id } })
    if (!contact) throw new NotFoundException(`Contact ${id} not found`)

    await prisma.contactForm.delete({ where: { id } })
    return { message: 'Contact deleted successfully' }
  }
}
