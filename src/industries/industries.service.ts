import { Injectable,InternalServerErrorException } from '@nestjs/common'
import { RedisService } from '../common/redis/redis.service'
import { promisify } from 'util'
import * as zlib from 'zlib'
import { prisma } from '../lib/prisma'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)
@Injectable()
export class IndustriesService {
  private prisma = prisma
   constructor(private redisService: RedisService) {}

  async createIndustry(name: string) {
    return this.prisma.industry.create({
      data: { name },
    })
  }

async getAllIndustries() {
  const client = this.redisService.getClient()
  const cacheKey = 'all_industries'

  const cachedData = await client.get(cacheKey)
  if (cachedData) {
    const decompressed = await gunzip(Buffer.from(cachedData, 'base64'))
    console.log('Data fetched from Redis (compressed)')
    return JSON.parse(decompressed.toString())
  }

  const industries = await this.prisma.industry.findMany({
    select: {
      id: true,
      name: true,
      subIndustries: {
        select: {
          id: true,
          name: true,
          images: {
            select: {
              id: true,
              file: true,
              text: true,
            },
          },
        },
      },
    },
  })

  const compressed = await gzip(JSON.stringify(industries))
  await client.set(cacheKey, compressed.toString('base64'))
  console.log('Data fetched from Database and cached (compressed)')

  return industries
}





  async getIndustryById(id: string) {
    return this.prisma.industry.findUnique({
      where: { id },
      include: { subIndustries: { include: { images: true } } },
    })
  }

  async updateIndustry(id: string, name: string) {
    return this.prisma.industry.update({
      where: { id },
      data: { name },
    })
  }

  async deleteIndustry(id: string) {
    return this.prisma.industry.delete({ where: { id } })
  }

async clearIndustriesCache() {
  const client = this.redisService.getClient()
  const cacheKey = 'all_industries'
  const exists = await client.exists(cacheKey)
  if (!exists) {
    return { message: 'No cache found to clear' }
  }
  await client.del(cacheKey)
  return { message: 'Industries cache cleared successfully' }
}


async getIndustriesWithSubIndustries() {
  const industries = await this.prisma.industry.findMany({
    select: {
      id: true,
      name: true,
      subIndustries: {
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              contents: true
            }
          }
        }
      }
    }
  })

  return industries.map(ind => ({
    id: ind.id,
    name: ind.name,
    subIndustries: ind.subIndustries.map(sub => ({
      id: sub.id,
      name: sub.name,
      totalItems: sub._count.contents
    }))
  }))
}



async getIndustriesWithSubOnly() {
  try {
    const industries = await this.prisma.industry.findMany({
      select: {
        id: true,
        name: true,
        subIndustries: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    return industries ?? []
  } catch (error) {
    throw new InternalServerErrorException('Unable to fetch industries')
  }
}

async getSubIndustriesWithReelsByIndustry(industryId: string) {
  const industry = await this.prisma.industry.findUnique({
    where: { id: industryId },
    select: {
      id: true,
      name: true,
      subIndustries: {
        select: {
          id: true,
          name: true,
          reels: {
            select: {
              id: true,
              file: true
            },
            orderBy: { createdAt: 'desc' }
          },
          _count: {
            select: { reels: true }
          }
        }
      }
    }
  })

  if (!industry) {
    throw new Error('Industry not found')
  }

  return {
    id: industry.id,
    name: industry.name,
    subIndustries: industry.subIndustries.map(sub => ({
      id: sub.id,
      name: sub.name,
      totalReels: sub._count.reels,
      reels: sub.reels
    }))
  }
}

}
