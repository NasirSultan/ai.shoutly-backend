import { Injectable, NotFoundException } from '@nestjs/common'
import { CreateLeadDto } from './dto/create-lead.dto'
import { prisma } from '../lib/prisma'

@Injectable()
export class LeadService {
  async create(dto: CreateLeadDto) {
    return prisma.lead.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        businessName: dto.businessName,
        city: dto.city,
        service: dto.service,
        message: dto.message,
        businessSize: dto.businessSize,
        promotion: dto.promotion,
        servicePage: dto.servicePage,
        serviceCategory: dto.serviceCategory,
        pageUrl: dto.pageUrl,
      },
    })
  }

  async findAll(opts: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = opts
    const skip = (page - 1) * limit

    const where: Record<string, any> = {}
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { businessName: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [total, data] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    }
  }

  async findOne(id: string) {
    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead) throw new NotFoundException(`Lead ${id} not found`)
    return lead
  }

  async toggleStatus(id: string) {
    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead) throw new NotFoundException(`Lead ${id} not found`)

    const newStatus = lead.status === 'PENDING' ? 'DONE' : 'PENDING'

    return prisma.lead.update({
      where: { id },
      data: { status: newStatus },
    })
  }

  async remove(id: string) {
    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead) throw new NotFoundException(`Lead ${id} not found`)

    await prisma.lead.delete({ where: { id } })
    return { message: 'Lead deleted successfully' }
  }
}
