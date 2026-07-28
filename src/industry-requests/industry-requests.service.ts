import { Injectable, NotFoundException } from '@nestjs/common'
import { CreateIndustryRequestDto } from './dto/create-industry-request.dto'
import { UpdateIndustryRequestStatusDto } from './dto/update-industry-request-status.dto'
import { prisma } from '../lib/prisma'

@Injectable()
export class IndustryRequestsService {
  async create(dto: CreateIndustryRequestDto) {
    return prisma.industryRequest.create({
      data: {
        industryName: dto.industryName,
        email: dto.email,
      },
    })
  }

  async findAll() {
    return prisma.industryRequest.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    const request = await prisma.industryRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundException(`Industry request ${id} not found`)
    return request
  }

  async updateStatus(id: string, dto: UpdateIndustryRequestStatusDto) {
    const request = await prisma.industryRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundException(`Industry request ${id} not found`)

    return prisma.industryRequest.update({
      where: { id },
      data: { status: dto.status },
    })
  }

  async remove(id: string) {
    const request = await prisma.industryRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundException(`Industry request ${id} not found`)

    await prisma.industryRequest.delete({ where: { id } })
    return { message: 'Industry request deleted successfully' }
  }
}
