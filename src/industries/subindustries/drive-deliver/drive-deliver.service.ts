import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../lib/prisma.service'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class DriveDeliverService {
  private s3: S3Client
  private bucketName: string
  private region: string
  private logger = new Logger('DriveDeliverService')

  constructor(private readonly prisma: PrismaService) {
    this.bucketName = process.env.AWS_BUCKET_NAME || ''
    this.region = process.env.AWS_REGION || 'ap-south-1'

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string
      }
    })
  }

  private getS3Url(key: string): string {
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`
  }

  private getExtFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/bmp': 'bmp'
    }
    return map[contentType] || 'jpg'
  }

  async deliverImages(subIndustryId?: string) {
    const where: any = {
      deletedAt: null,
      file: { contains: 'drive.google.com' }
    }
    if (subIndustryId) where.subIndustryId = subIndustryId

    const images = await this.prisma.image.findMany({
      where,
      select: { id: true, file: true, subIndustryId: true }
    })

    if (images.length === 0) {
      return { success: true, message: 'No Google Drive images found to deliver.', delivered: 0, failed: 0 }
    }

    this.logger.log(`Delivering ${images.length} Drive image(s) to S3...`)

    let delivered = 0
    let failed = 0
    const errors: { id: string; error: string }[] = []

    for (const image of images) {
      try {
        const response = await axios.get(image.file, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })

        const contentType = String(response.headers['content-type'] || 'image/jpeg')
        const ext = this.getExtFromContentType(contentType.split(';')[0].trim())
        const key = `images/${uuidv4()}.${ext}`
        const buffer = Buffer.from(response.data)

        await this.s3.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: contentType as string,
          ACL: 'public-read'
        }))

        const s3Url = this.getS3Url(key)

        await this.prisma.image.update({
          where: { id: image.id },
          data: { file: s3Url, deleteUrl: '' }
        })

        this.logger.log(`✅ Delivered image ${image.id} → ${s3Url}`)
        delivered++
      } catch (err) {
        this.logger.error(`❌ Failed image ${image.id}: ${err.message}`)
        errors.push({ id: image.id, error: err.message })
        failed++
      }
    }

    return {
      success: true,
      message: `Delivered ${delivered} image(s) to S3. Failed: ${failed}.`,
      delivered,
      failed,
      ...(errors.length > 0 ? { errors } : {})
    }
  }
}
