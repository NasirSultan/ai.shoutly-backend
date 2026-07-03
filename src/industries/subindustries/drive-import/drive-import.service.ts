import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../lib/prisma.service'
import { google } from 'googleapis'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { v4 as uuidv4 } from 'uuid'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp')

@Injectable()
export class DriveImportService {
  private s3: S3Client
  private bucketName: string
  private region: string
  private logger = new Logger('DriveImportService')

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

  private getDriveClient() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    })
    return google.drive({ version: 'v3', auth })
  }

  private getS3Url(key: string): string {
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`
  }

  private async compressImage(buffer: Buffer): Promise<Buffer> {
    const TARGET_SIZE = 900 * 1024 // 900KB — safely under 1MB
    let quality = 85

    let compressed = await sharp(buffer).jpeg({ quality, mozjpeg: true }).toBuffer()

    while (compressed.length > TARGET_SIZE && quality > 40) {
      quality -= 10
      compressed = await sharp(buffer).jpeg({ quality, mozjpeg: true }).toBuffer()
    }

    return compressed
  }

  private async uploadDriveFileToS3(drive: any, fileId: string): Promise<string> {
    const key = `images/${uuidv4()}.jpg`

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    )

    const rawBuffer = Buffer.from(response.data as ArrayBuffer)
    const compressed = await this.compressImage(rawBuffer)

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: compressed,
      ContentType: 'image/jpeg',
      ACL: 'public-read'
    }))

    return this.getS3Url(key)
  }

  async importFromDrive(subIndustryId: string, folderId: string) {
    const drive = this.getDriveClient()

    const subIndustry = await this.prisma.subIndustry.findUnique({
      where: { id: subIndustryId }
    })

    if (!subIndustry) {
      return { success: false, message: 'SubIndustry not found' }
    }

    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: 'files(id, name, mimeType)'
    })

    const files = res.data.files || []
    this.logger.log(`Found ${files.length} file(s) in Drive folder`)

    let imported = 0
    let skipped = 0
    let failed = 0

    const processFile = async (file: any) => {
      const fileId = file.id!
      const driveUrl = `https://drive.google.com/uc?export=view&id=${fileId}`

      const exists = await this.prisma.image.findFirst({
        where: { driveUrl, subIndustryId }
      })

      if (exists) {
        skipped++
        this.logger.log(`⏭ Skipped ${file.name} (duplicate)`)
        return
      }

      const s3Url = await this.uploadDriveFileToS3(drive, fileId)

      await this.prisma.image.create({
        data: { file: s3Url, driveUrl, subIndustryId, deleteUrl: '' }
      })

      this.logger.log(`✅ Imported ${file.name} → ${s3Url}`)
      imported++
    }

    // Worker pool: 5 concurrent workers pull from a shared queue.
    // Keeps DB connections within pgBouncer limits while maximising throughput.
    const CONCURRENCY = 5
    const queue = [...files]
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const file = queue.shift()!
        await processFile(file).catch((e: any) => {
          this.logger.error(`❌ Failed ${file.name}: ${e.message}`)
          failed++
        })
      }
    })
    await Promise.all(workers)

    return {
      success: true,
      total: files.length,
      imported,
      skippedDuplicates: skipped,
      failed,
      message: `${imported} imported, ${skipped} skipped (already exist), ${failed} failed out of ${files.length} total.`
    }
  }
}
