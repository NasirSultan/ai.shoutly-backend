import { Injectable,InternalServerErrorException,NotFoundException,BadRequestException  } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import FormData from 'form-data'
import * as dotenv from 'dotenv'
import { Express } from 'express'
import { RedisService } from '../../common/redis/redis.service'
import { createHash } from 'crypto'
dotenv.config()

const prisma = new PrismaClient()
const imgbbKey = process.env.IMGBB_KEY

type ImgbbUploadResult = {
  imageUrl: string
  deleteUrl: string
}

@Injectable()
export class ImagesService {
  constructor(private redisService: RedisService) {}
  // for testing only
   async uploadToImgbb(file: Express.Multer.File): Promise<ImgbbUploadResult> {
  console.log('Uploading file:', file.originalname, 'size:', file.size)
  console.log('ImgBB key present:', !!imgbbKey)
  const base64 = file.buffer.toString('base64')
  console.log('Base64 length:', base64.length)

  const form = new FormData()
  form.append('image', base64)

  try {
    const res = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbbKey}`,
      form,
      { headers: form.getHeaders() }
    )
    console.log('ImgBB response:', res.data)
    return {
      imageUrl: res.data.data.url,
      deleteUrl: res.data.data.delete_url
    }
  } catch (error: any) {
    if (error.response) {
      console.error('Axios error status:', error.response.status)
      console.error('Axios error data:', error.response.data)
    } else {
      console.error('Axios error:', error.message)
    }
    throw error
  }
}



  // async uploadToImgbb(file: Express.Multer.File): Promise<ImgbbUploadResult> {
  //   const form = new FormData()
  //   form.append('image', file.buffer.toString('base64'))

  //   const res = await axios.post(
  //     `https://api.imgbb.com/1/upload?key=${imgbbKey}`,
  //     form,
  //     { headers: form.getHeaders() }
  //   )

  //   return {
  //     imageUrl: res.data.data.url,
  //     deleteUrl: res.data.data.delete_url
  //   }
  // }

  async uploadMultipleToImgbb(
    files: Express.Multer.File[]
  ): Promise<ImgbbUploadResult[]> {
    const uploaded: ImgbbUploadResult[] = []

    for (const file of files) {
      const result = await this.uploadToImgbb(file)
      uploaded.push(result)
    }

    return uploaded
  }

  async deleteFromImgbb(deleteUrls: string[]) {
    for (const url of deleteUrls) {
      await axios.get(url)
    }
  }

async createMultipleSafe(
  files: Express.Multer.File[],
  subIndustryId: string,
  text: boolean
) {
  const uploaded = await this.uploadMultipleToImgbb(files)

  const data = uploaded.map(item => ({
    file: item.imageUrl,
    deleteUrl: item.deleteUrl,
    subIndustryId,
    text
  }))

  try {
    await prisma.image.createMany({ data })
    return {
      success: true,
      total: data.length,
      images: data
    }
  } catch {
    const deleteUrls = uploaded.map(item => item.deleteUrl)
    await this.deleteFromImgbb(deleteUrls)
    throw new Error('Database failed. Images rolled back.')
  }
}

  async findAll(subIndustryId: string) {
    return prisma.image.findMany({
      where: { subIndustryId, deletedAt: null }
    })
  }

  async findGroupedByText(subIndustryId: string) {
    const subIndustry = await prisma.subIndustry.findUnique({
      where: { id: subIndustryId },
      select: {
        id: true,
        name: true,
        industry: { select: { name: true } }
      }
    })

    if (!subIndustry) return null

    const [textTrue, textFalse] = await Promise.all([
      prisma.image.findMany({
        where: { subIndustryId, text: true, deletedAt: null },
        select: { id: true, file: true }
      }),
      prisma.image.findMany({
        where: { subIndustryId, text: false, deletedAt: null },
        select: { id: true, file: true }
      })
    ])

    return {
      subIndustryId: subIndustry.id,
      subIndustryName: subIndustry.name,
      industryName: subIndustry.industry.name,
      groups: [
        {
          text: true,
          total: textTrue.length,
          images: textTrue
        },
        {
          text: false,
          total: textFalse.length,
          images: textFalse
        }
      ]
    }
  }

async deleteBySubIndustryAndText(subIndustryId: string, text: boolean) {
  const images = await prisma.image.findMany({
    where: { subIndustryId, text, deletedAt: null },
    select: { id: true }
  })

  if (images.length === 0) {
    return {
      success: false,
      message: `No images found for subIndustryId '${subIndustryId}' with text=${text}`
    }
  }

  const updated = await prisma.image.updateMany({
    where: { subIndustryId, text, deletedAt: null },
    data: { deletedAt: new Date() }
  })

  return {
    success: true,
    message: `Soft deleted ${updated.count} image(s).`,
    deletedCount: updated.count
  }
}



 async getDeletedImages(subIndustryId?: string) {
  return prisma.image.findMany({
    where: {
      deletedAt: { not: null },
      ...(subIndustryId ? { subIndustryId } : {})
    },
    select: { id: true, file: true, text: true, subIndustryId: true, deletedAt: true }
  })
}

async restoreImage(imageId: string) {
  const image = await prisma.image.findUnique({ where: { id: imageId } })
  if (!image) throw new NotFoundException('Image not found')
  if (!image.deletedAt) throw new BadRequestException('Image is not deleted')

  await prisma.image.update({ where: { id: imageId }, data: { deletedAt: null } })
  return { success: true, message: 'Image restored successfully' }
}

async restoreAllImages(subIndustryId?: string) {
  const updated = await prisma.image.updateMany({
    where: {
      deletedAt: { not: null },
      ...(subIndustryId ? { subIndustryId } : {})
    },
    data: { deletedAt: null }
  })
  return { success: true, message: `Restored ${updated.count} image(s).`, restoredCount: updated.count }
}

async deleteAllImages() {
  const deleted = await prisma.image.deleteMany()
  return {
    success: true,
    message: `Deleted ${deleted.count} image(s) from database.`,
    deletedCount: deleted.count
  }
}

async getImagesBySubIndustry(subIndustryId?: string) {
    const redis = this.redisService.getClient()
    const cacheKey = subIndustryId ? `subIndustry:${subIndustryId}:images` : 'allImages'
    const cacheTTL = 3600

    let images: { id: string; file: string; subIndustryId: string }[] = []
    const cached = await redis.get(cacheKey)

    if (cached) {
      images = JSON.parse(cached)
    } else {
      if (subIndustryId) {
        const validSubIndustry = await prisma.subIndustry.findUnique({ where: { id: subIndustryId } })
        if (!validSubIndustry) throw new BadRequestException('Invalid subIndustryId')

        images = await prisma.$queryRaw`
          SELECT id, file, "subIndustryId"
          FROM "Image"
          WHERE "subIndustryId" = ${subIndustryId} AND "deletedAt" IS NULL
          ORDER BY RANDOM()
          LIMIT 15
        `
      } else {
        images = await prisma.$queryRaw`
          SELECT id, file, "subIndustryId"
          FROM "Image"
          WHERE "deletedAt" IS NULL
          ORDER BY RANDOM()
          LIMIT 15
        `
      }
      await redis.set(cacheKey, JSON.stringify(images), { EX: cacheTTL })
    }

    return images
  }



 async deleteImageById(imageId: string) {
    const image = await prisma.image.findUnique({ where: { id: imageId, deletedAt: null } })
    if (!image) throw new NotFoundException('Image not found')

    try {
      await prisma.image.update({ where: { id: imageId }, data: { deletedAt: new Date() } })
      return { success: true, message: 'Image soft deleted successfully' }
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete image from database')
    }
  }


async getOneTextImageBySubIndustry(subIndustryId: string) {
  type ImageType = { id: string; file: string; subIndustryId: string }

  const validSubIndustry = await prisma.subIndustry.findUnique({ where: { id: subIndustryId } })
  if (!validSubIndustry) throw new BadRequestException('Invalid subIndustryId')

  const images = (await prisma.$queryRaw<ImageType[]>`
    SELECT id, file, "subIndustryId"
    FROM "Image"
    WHERE "subIndustryId" = ${subIndustryId} AND text = true AND "deletedAt" IS NULL
    ORDER BY RANDOM()
    LIMIT 1
  `) as ImageType[]

  const image = images[0] || null
  if (!image) throw new NotFoundException('No image with text=true found')

  return image
}
  
}
