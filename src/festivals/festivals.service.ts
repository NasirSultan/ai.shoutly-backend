import { Injectable, NotFoundException } from '@nestjs/common'
import { FestivalType } from '@prisma/client'
import { CreateFestivalDto } from './dto/create-festival.dto'
import { UpdateFestivalDto } from './dto/update-festival.dto'
import { prisma } from '../lib/prisma'

@Injectable()
export class FestivalsService {
  async create(dto: CreateFestivalDto) {
    return prisma.festival.create({
      data: {
        date: new Date(dto.date),
        event: dto.event,
        type: dto.type,
      },
    })
  }

  async bulkCreate(items: CreateFestivalDto[]) {
    const data = items.map((dto) => ({
      date: new Date(dto.date),
      event: dto.event,
      type: dto.type,
    }))
    await prisma.festival.createMany({ data, skipDuplicates: true })
    return { created: data.length }
  }

  async findAll(opts: {
    page: number
    limit: number
    type?: FestivalType
    month?: number
    year?: number
    search?: string
    upcoming?: boolean
  }) {
    const { page, limit, type, month, year, search, upcoming } = opts
    const offset = (page - 1) * limit

    const where: any = {}

    if (type) where.type = type
    if (search) where.event = { contains: search, mode: 'insensitive' }
    if (upcoming) where.date = { gte: new Date() }

    if (month || year) {
      const now = new Date()
      const y = year ?? now.getFullYear()
      if (month) {
        where.date = {
          ...(where.date ?? {}),
          gte: new Date(y, month - 1, 1),
          lt: new Date(y, month, 1),
        }
      } else {
        where.date = {
          ...(where.date ?? {}),
          gte: new Date(y, 0, 1),
          lt: new Date(y + 1, 0, 1),
        }
      }
    }

    const [total, data] = await Promise.all([
      prisma.festival.count({ where }),
      prisma.festival.findMany({
        where,
        orderBy: { date: 'asc' },
        skip: offset,
        take: limit,
      }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async findToday() {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return prisma.festival.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    })
  }

  async findUpcoming() {
    return prisma.festival.findMany({
      where: { date: { gte: new Date() } },
      orderBy: { date: 'asc' },
      take: 10,
    })
  }

  async findOne(id: string) {
    const festival = await prisma.festival.findUnique({ where: { id } })
    if (!festival) throw new NotFoundException('Festival not found')
    return festival
  }

  async update(id: string, dto: UpdateFestivalDto) {
    await this.findOne(id)
    return prisma.festival.update({
      where: { id },
      data: {
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.event && { event: dto.event }),
        ...(dto.type && { type: dto.type }),
      },
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    await prisma.festival.delete({ where: { id } })
    return { deleted: true }
  }

  async getImages(festivalId: string) {
    await this.findOne(festivalId)
    return prisma.festivalImage.findMany({
      where: { festivalId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
  }
}
