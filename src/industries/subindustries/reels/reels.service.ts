import { Injectable, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import { Express } from 'express'

const prisma = new PrismaClient()

@Injectable()
export class ReelsService {
  private s3!: S3Client
  private bucketName: string
  private region: string
  private logger = new Logger('ReelsService')

  constructor() {
    this.bucketName = process.env.AWS_BUCKET_NAME || ''
    this.region = process.env.AWS_REGION || 'us-east-1'

    if (
      process.env.AWS_BUCKET_NAME &&
      process.env.AWS_REGION &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
    ) {
      this.s3 = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string
        }
      })
    }
  }

  async uploadMultipleReels(subIndustryId: string, files: Express.Multer.File[]) {
    const results: {
      filename: string
      status: string
      url?: string
      error?: string
    }[] = []

for (const file of files) {
  const fileExtension = path.extname(file.originalname)
  const key = `reels/${uuidv4()}${fileExtension}`

  this.logger.log(`Start uploading file: ${file.originalname}`)

  try {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read'
      })
    )

    const fileUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`

    await prisma.reel.create({
      data: {
        subIndustryId,
        file: fileUrl
      }
    })

    this.logger.log(`Successfully uploaded file: ${file.originalname}`)

    results.push({
      filename: file.originalname,
      status: 'success',
      url: fileUrl
    })
  } catch (error) {
    this.logger.error(`Failed to upload file ${file.originalname}: ${(error as Error).message}`)

    results.push({
      filename: file.originalname,
      status: 'failed',
      error: (error as Error).message
    })
  }

  this.logger.log(`Finished processing file: ${file.originalname}`)
}
    return results
  }

  async findAllBySubIndustry(subIndustryId: string) {
    return prisma.reel.findMany({
      where: { subIndustryId },
      orderBy: { createdAt: 'desc' }
    })
  }

  async deleteReelById(reelId: string) {
    const reel = await prisma.reel.findUnique({ where: { id: reelId } })
    if (!reel) throw new Error('Reel not found')

    const key = reel.file.split(`https://${this.bucketName}.s3.${this.region}.amazonaws.com/`)[1]

    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })
    )

    return prisma.reel.delete({ where: { id: reelId } })
  }
}