// import { Injectable } from '@nestjs/common'
// import { PrismaClient } from '@prisma/client'
// import { google } from 'googleapis'

// @Injectable()
// export class DriveImportService {
//   private prisma = new PrismaClient()

//   private getDriveClient() {
//     const credentials = JSON.parse(
//       process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string
//     )

//     const auth = new google.auth.GoogleAuth({
//       credentials,
//       scopes: ['https://www.googleapis.com/auth/drive.readonly']
//     })

//     return google.drive({ version: 'v3', auth })
//   }

//   async importFromDrive(subIndustryId: string, folderId: string) {
//     const drive = this.getDriveClient()

//     // 1. Check subIndustry exists
//     const subIndustry = await this.prisma.subIndustry.findUnique({
//       where: { id: subIndustryId }
//     })

//     if (!subIndustry) {
//       return {
//         success: false,
//         message: 'SubIndustry not found'
//       }
//     }

//     // 2. Get files from Google Drive
//     const res = await drive.files.list({
//       q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
//       fields: 'files(id, name)'
//     })

//     const files = res.data.files || []

//     let imported = 0
//     let skipped = 0
//     let failed = 0

//     const batch: {
//       file: string
//       subIndustryId: string
//       deleteUrl: string
//     }[] = []
    
//     for (const file of files) {
//       try {
//         const fileId = file.id

//         const url = `https://drive.google.com/uc?export=view&id=${fileId}`

//         // 3. Duplicate check (your style)
//         const exists = await this.prisma.image.findFirst({
//           where: {
//             file: url,
//             subIndustryId
//           }
//         })

//         if (exists) {
//           skipped++
//           continue
//         }

//         batch.push({
//           file: url,
//           subIndustryId,
//           deleteUrl: ''
//         })

//         // 4. Batch insert every 20
//         if (batch.length === 20) {
//           await this.prisma.image.createMany({
//             data: batch
//           })
//           imported += batch.length
//           batch.length = 0
//         }
//       } catch (e) {
//         failed++
//       }
//     }

//     // 5. insert remaining
//     if (batch.length > 0) {
//       await this.prisma.image.createMany({
//         data: batch
//       })
//       imported += batch.length
//     }

//     return {
//       success: true,
//       imported,
//       skipped,
//       failed,
//       total: files.length
//     }
//   }
// }

import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'
import * as path from 'path'

@Injectable()
export class DriveImportService {
  private prisma = new PrismaClient()

  private getDriveClient() {
    // Resolve the path to your json file
    // Assumes the file is in your project root
    const KEYFILEPATH = path.join(process.cwd(), 'service-account.json');

    const auth = new google.auth.GoogleAuth({
      keyFile: KEYFILEPATH, // Point directly to the file
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    })

    return google.drive({ version: 'v3', auth })
  }

  async importFromDrive(subIndustryId: string, folderId: string) {
    const drive = this.getDriveClient()

    // 1. Check subIndustry exists
    const subIndustry = await this.prisma.subIndustry.findUnique({
      where: { id: subIndustryId }
    })

    if (!subIndustry) {
      return {
        success: false,
        message: 'SubIndustry not found'
      }
    }

    // 2. Get files from Google Drive
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: 'files(id, name)'
    })

    const files = res.data.files || []
    console.log('Files:', files);

    let imported = 0
    let skipped = 0
    let failed = 0

    const batch: {
      file: string
      subIndustryId: string
      deleteUrl: string
    }[] = []

    for (const file of files) {
      try {
        const fileId = file.id
        // Constructing the direct view URL
        const url = `https://drive.google.com/uc?export=view&id=${fileId}`

        // 3. Duplicate check
        const exists = await this.prisma.image.findFirst({
          where: {
            file: url,
            subIndustryId
          }
        })

        if (exists) {
          skipped++
          continue
        }

        batch.push({
          file: url,
          subIndustryId,
          deleteUrl: ''
        })

        // 4. Batch insert every 20
        if (batch.length === 20) {
          await this.prisma.image.createMany({
            data: batch
          })
          imported += batch.length
          batch.length = 0
        }
      } catch (e) {
        failed++
      }
    }

    // 5. Insert remaining
    if (batch.length > 0) {
      console.log('Batch:', batch)
      // await this.prisma.image.createMany({
      //   data: batch
      // })
      imported += batch.length
    }

    return {
      success: true,
      imported,
      skipped,
      failed,
      total: files.length
    }
  }
}