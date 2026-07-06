import { Injectable } from '@nestjs/common'
import { prisma } from '../../lib/prisma'

@Injectable()
export class SubindustriesService {
  private prisma = prisma

  async createSubindustries(industryId: string, names: string[]) {
    const data = names.map(n => ({
      name: n,
      industryId: industryId
    }))

    return this.prisma.subIndustry.createMany({
      data: data,
      skipDuplicates: true
    })
  }

  
  async getAllSubindustries() {
    return this.prisma.subIndustry.findMany({
      include: { images: true, industry: true }
    })
  }

  async getSubindustryById(id: string) {
    return this.prisma.subIndustry.findUnique({
      where: { id },
      include: { images: true, industry: true }
    })
  }

  async updateSubindustry(id: string, name: string) {
    return this.prisma.subIndustry.update({
      where: { id },
      data: { name }
    })
  }

  async deleteSubindustry(id: string) {
    return this.prisma.subIndustry.delete({
      where: { id }
    })
  }


  
}
