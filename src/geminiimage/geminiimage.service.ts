// // geminiimage.service.ts

// import { Injectable, InternalServerErrorException } from '@nestjs/common'
// import { PrismaClient } from '@prisma/client'
// import { GeminiService } from '../lib/llm/geminillm/gemini.service'
// import { ImgbbService } from '../lib/imgbb/imgbb.service'
// import { buildPostImagePrompt, buildPostTextPrompt } from '../lib/prompt/post.prompt'
// import { Express } from 'express'

// const prisma = new PrismaClient()

// export interface GeneratedPost {
//   image: { imageUrl: string; deleteUrl?: string }
//   text: string
//   hashtags: string[]
//   source: 'LLM' | 'DB'
//   index: number
// }

// export interface StreamEvent {
//   index: number
//   post: GeneratedPost
//   saved?: any
// }

// type OnPost = (event: StreamEvent) => void

// const DB_DELAY_MS = 10000

// @Injectable()
// export class PostGeneratorService {
//   constructor(
//     private readonly geminiService: GeminiService,
//     private readonly imgbbService: ImgbbService
//   ) {}

//   async generateMixedPostsStreamed(
//     industryId: string,
//     subIndustryId: string,
//     userPrompt: string,
//     onPost: OnPost
//   ): Promise<void> {
//     const { industry, subIndustry, dbImages, textResults } =
//       await this.resolveBaseData(industryId, subIndustryId, userPrompt)

//     // Start LLM generations immediately at t=0
//     const llmStartTime = Date.now()
//     const llm1Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 1)
//     const llm2Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 2)

//     const streamOrder: Array<{ type: 'DB'; dbIndex: number } | { type: 'LLM'; llmSlot: 1 | 2 }> = [
//       { type: 'DB',  dbIndex: 0 },
//       { type: 'DB',  dbIndex: 1 },
//       { type: 'LLM', llmSlot: 1 },
//       { type: 'DB',  dbIndex: 2 },
//       { type: 'DB',  dbIndex: 3 },
//       { type: 'DB',  dbIndex: 4 },
//       { type: 'LLM', llmSlot: 2 },
//     ]

//     let globalIndex = 0

//     for (const item of streamOrder) {
//       if (item.type === 'DB') {
//         await this.delay(DB_DELAY_MS)
//         const { text, hashtags } = textResults[globalIndex]
//         onPost({
//           index: globalIndex,
//           post: {
//             image: { imageUrl: dbImages[item.dbIndex].file },
//             text,
//             hashtags,
//             source: 'DB',
//             index: globalIndex,
//           },
//         })
//       } else {
//         const llmPromise = item.llmSlot === 1 ? llm1Promise : llm2Promise
//         const elapsed = Date.now() - llmStartTime
//         const { text, hashtags } = textResults[globalIndex]

//         // Wait for LLM only if not ready yet, otherwise render immediately
//         const llmImage = await llmPromise
//         const waitedMs = Date.now() - llmStartTime - elapsed
//         if (waitedMs > 0) {
//           console.log(`[LLM slot ${item.llmSlot}] waited extra ${waitedMs}ms`)
//         }

//         onPost({
//           index: globalIndex,
//           post: {
//             image: llmImage,
//             text,
//             hashtags,
//             source: 'LLM',
//             index: globalIndex,
//           },
//         })
//       }

//       globalIndex++
//     }
//   }

//   async generateMixedAndSavePostsStreamed(
//     userId: string,
//     industryId: string,
//     subIndustryId: string,
//     userPrompt: string,
//     postTime: Date,
//     onPost: OnPost
//   ): Promise<void> {
//     const { industry, subIndustry, dbImages, textResults } =
//       await this.resolveBaseData(industryId, subIndustryId, userPrompt)

//     // Start LLM generations immediately at t=0
//     const llm1Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 1)
//     const llm2Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 2)

//     const streamOrder: Array<{ type: 'DB'; dbIndex: number } | { type: 'LLM'; llmSlot: 1 | 2 }> = [
//       { type: 'DB',  dbIndex: 0 },
//       { type: 'DB',  dbIndex: 1 },
//       { type: 'LLM', llmSlot: 1 },
//       { type: 'DB',  dbIndex: 2 },
//       { type: 'DB',  dbIndex: 3 },
//       { type: 'DB',  dbIndex: 4 },
//       { type: 'LLM', llmSlot: 2 },
//     ]

//     let globalIndex = 0

//     for (const item of streamOrder) {
//       if (item.type === 'DB') {
//         await this.delay(DB_DELAY_MS)
//       }

//       const { text, hashtags } = textResults[globalIndex]

//       const savedHashtags = await Promise.all(
//         hashtags.map((tag) =>
//           prisma.hashtag.upsert({ where: { tag }, update: {}, create: { tag } })
//         )
//       )

//       const savedContent = await prisma.content.create({
//         data: {
//           text,
//           subIndustryId,
//           hashtags: { create: savedHashtags.map((h) => ({ hashtagId: h.id })) },
//         },
//       })

//       if (item.type === 'DB') {
//         const dbImage = dbImages[item.dbIndex]
//         const calendarPost = await prisma.calendarPost.create({
//           data: {
//             userId,
//             subIndustryId,
//             contentId: savedContent.id,
//             imageId: dbImage.id,
//             type: 'IMAGE',
//             postTime,
//             status: 'SCHEDULED',
//           },
//         })
//         onPost({
//           index: globalIndex,
//           post: { image: { imageUrl: dbImage.file }, text, hashtags, source: 'DB', index: globalIndex },
//           saved: { image: dbImage, calendarPost, content: savedContent },
//         })
//       } else {
//         const uploaded = await (item.llmSlot === 1 ? llm1Promise : llm2Promise)
//         const savedImage = await prisma.image.create({
//           data: { file: uploaded.imageUrl, deleteUrl: uploaded.deleteUrl, subIndustryId, text: false },
//         })
//         const calendarPost = await prisma.calendarPost.create({
//           data: {
//             userId,
//             subIndustryId,
//             contentId: savedContent.id,
//             imageId: savedImage.id,
//             type: 'IMAGE',
//             postTime,
//             status: 'SCHEDULED',
//           },
//         })
//         onPost({
//           index: globalIndex,
//           post: { image: uploaded, text, hashtags, source: 'LLM', index: globalIndex },
//           saved: { image: savedImage, calendarPost, content: savedContent },
//         })
//       }

//       globalIndex++
//     }
//   }

//   // ── Shared resolver ────────────────────────────────────────────────────────

//   private async resolveBaseData(industryId: string, subIndustryId: string, userPrompt: string) {
//     const [industry, subIndustry] = await Promise.all([
//       prisma.industry.findUnique({ where: { id: industryId } }),
//       prisma.subIndustry.findUnique({ where: { id: subIndustryId } }),
//     ])

//     if (!industry || !subIndustry) {
//       throw new InternalServerErrorException('Invalid industry or sub-industry ID')
//     }

//     const [dbImages, ...textRaws] = await Promise.all([
//       prisma.image.findMany({
//         where: { subIndustryId },
//         orderBy: { createdAt: 'desc' },
//         take: 5,
//       }),
//       ...Array.from({ length: 7 }, (_, i) =>
//         this.geminiService.generateText(
//           buildPostTextPrompt(industry.name, subIndustry.name, `${userPrompt} (variation ${i + 1})`)
//         )
//       ),
//     ])

//     if ((dbImages as any[]).length < 5) {
//       throw new InternalServerErrorException(
//         `Not enough DB images. Found ${(dbImages as any[]).length}, need 5.`
//       )
//     }

//     const textResults = (textRaws as string[]).map((raw) => this.parseTextResult(raw))

//     return { industry, subIndustry, dbImages: dbImages as any[], textResults }
//   }

//   // ── Helpers ────────────────────────────────────────────────────────────────

//   private async generateAndUploadLLMImage(
//     industryName: string,
//     subIndustryName: string,
//     userPrompt: string,
//     variation: number
//   ): Promise<{ imageUrl: string; deleteUrl: string }> {
//     const base64Images = await this.geminiService.generateImages(
//       buildPostImagePrompt(industryName, subIndustryName, userPrompt, variation)
//     )
//     return this.uploadBase64Image(base64Images, `post_image_${variation}.png`)
//   }

//   private async uploadBase64Image(
//     base64Images: string[],
//     filename: string
//   ): Promise<{ imageUrl: string; deleteUrl: string }> {
//     if (!base64Images.length) {
//       throw new InternalServerErrorException(`No image generated for ${filename}`)
//     }
//     const buffer = Buffer.from(base64Images[0], 'base64')
//     const fakeFile: Express.Multer.File = {
//       buffer,
//       originalname: filename,
//       mimetype: 'image/png',
//       size: buffer.length,
//     } as Express.Multer.File
//     return this.imgbbService.uploadFile(fakeFile)
//   }

//   private parseTextResult(raw: string): { text: string; hashtags: string[] } {
//     try {
//       const clean = raw.replace(/```json|```/gi, '').trim()
//       const parsed = JSON.parse(clean)
//       return {
//         text: parsed.text ?? '',
//         hashtags: Array.isArray(parsed.hashtags)
//           ? parsed.hashtags.map((h: string) => h.replace(/^#/, '').trim())
//           : [],
//       }
//     } catch {
//       return { text: raw.trim(), hashtags: [] }
//     }
//   }

//   private delay(ms: number): Promise<void> {
//     return new Promise((resolve) => setTimeout(resolve, ms))
//   }
// }







// geminiimage.service.ts

import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { GeminiService } from '../lib/llm/geminillm/gemini.service'
import { ImgbbService } from '../lib/imgbb/imgbb.service'
import { buildPostImagePrompt,buildUserTextPrompt, buildPostTextPrompt } from '../lib/prompt/post.prompt'
import { Express } from 'express'

const prisma = new PrismaClient()

export interface GeneratedPost {
  image: { imageUrl: string; deleteUrl?: string }
  text: string
  hashtags: string[]
  source: 'LLM' | 'DB'
  index: number
}

export interface StreamEvent {
  index: number
  post: GeneratedPost
  saved?: any
}

interface TextResult {
  text: string
  hashtags: string[]
}

interface BaseData {
  industry: { id: string; name: string }
  subIndustry: { id: string; name: string }
  dbImages: any[]
  textResults: TextResult[]
}

interface LLMOnlyMode {
  type: 'LLM_ONLY'
  context: string
  industry: string
  subIndustry: string
}

interface MixedMode {
  type: 'MIXED'
  data: BaseData
}

type ResolvedMode = LLMOnlyMode | MixedMode

type OnPost = (event: StreamEvent) => void

const DB_DELAY_MS = 10000

@Injectable()
export class PostGeneratorService {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly imgbbService: ImgbbService
  ) {}

  async generateMixedPostsStreamed(
    industryId: string | undefined,
    subIndustryId: string | undefined,
    userPrompt: string,
    onPost: OnPost
  ): Promise<void> {
    const mode = await this.resolveMode(industryId, subIndustryId, userPrompt)

    if (mode.type === 'LLM_ONLY') {
      await this.streamLLMOnly(userPrompt, mode.industry, mode.subIndustry, onPost)
      return
    }

    const { industry, subIndustry, dbImages, textResults } = mode.data

    const llm1Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 1)
    const llm2Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 2)

    const streamOrder: Array<{ type: 'DB'; dbIndex: number } | { type: 'LLM'; llmSlot: 1 | 2 }> = [
      { type: 'DB',  dbIndex: 0 },
      { type: 'DB',  dbIndex: 1 },
      { type: 'LLM', llmSlot: 1 },
      { type: 'DB',  dbIndex: 2 },
      { type: 'DB',  dbIndex: 3 },
      { type: 'DB',  dbIndex: 4 },
      { type: 'LLM', llmSlot: 2 },
    ]

    let globalIndex = 0

    for (const item of streamOrder) {
      if (item.type === 'DB') {
        await this.delay(DB_DELAY_MS)
        const { text, hashtags } = textResults[globalIndex]
        onPost({
          index: globalIndex,
          post: {
            image: { imageUrl: dbImages[item.dbIndex].file },
            text,
            hashtags,
            source: 'DB',
            index: globalIndex,
          },
        })
      } else {
        const { text, hashtags } = textResults[globalIndex]
        const llmImage = await (item.llmSlot === 1 ? llm1Promise : llm2Promise)
        onPost({
          index: globalIndex,
          post: { image: llmImage, text, hashtags, source: 'LLM', index: globalIndex },
        })
      }
      globalIndex++
    }
  }

  async generateMixedAndSavePostsStreamed(
    userId: string,
    industryId: string | undefined,
    subIndustryId: string | undefined,
    userPrompt: string,
    postTime: Date,
    onPost: OnPost
  ): Promise<void> {
    const mode = await this.resolveMode(industryId, subIndustryId, userPrompt)

    if (mode.type === 'LLM_ONLY') {
      await this.streamLLMOnlyAndSave(
        userId,
        subIndustryId,
        userPrompt,
        postTime,
        mode.industry,
        mode.subIndustry,
        onPost
      )
      return
    }

    const { industry, subIndustry, dbImages, textResults } = mode.data

    const llm1Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 1)
    const llm2Promise = this.generateAndUploadLLMImage(industry.name, subIndustry.name, userPrompt, 2)

    const streamOrder: Array<{ type: 'DB'; dbIndex: number } | { type: 'LLM'; llmSlot: 1 | 2 }> = [
      { type: 'DB',  dbIndex: 0 },
      { type: 'DB',  dbIndex: 1 },
      { type: 'LLM', llmSlot: 1 },
      { type: 'DB',  dbIndex: 2 },
      { type: 'DB',  dbIndex: 3 },
      { type: 'DB',  dbIndex: 4 },
      { type: 'LLM', llmSlot: 2 },
    ]

    let globalIndex = 0

    for (const item of streamOrder) {
      if (item.type === 'DB') {
        await this.delay(DB_DELAY_MS)
      }
      
      const { text, hashtags } = textResults[globalIndex]

      const savedHashtags = await Promise.all(
        hashtags.map((tag) =>
          prisma.hashtag.upsert({ where: { tag }, update: {}, create: { tag } })
        )
      )

      const savedContent = await prisma.content.create({
        data: {
          text,
          subIndustryId: subIndustry.id,
          hashtags: { create: savedHashtags.map((h) => ({ hashtagId: h.id })) },
        },
      })

      if (item.type === 'DB') {
        const dbImage = dbImages[item.dbIndex]
        const calendarPost = await prisma.calendarPost.create({
          data: {
            userId,
            subIndustryId: subIndustry.id,
            contentId: savedContent.id,
            imageId: dbImage.id,
            type: 'IMAGE',
            postTime,
            status: 'SCHEDULED',
          },
        })
        onPost({
          index: globalIndex,
          post: { image: { imageUrl: dbImage.file }, text, hashtags, source: 'DB', index: globalIndex },
          saved: { image: dbImage, calendarPost, content: savedContent },
        })
      } else {
        const uploaded = await (item.llmSlot === 1 ? llm1Promise : llm2Promise)
        const savedImage = await prisma.image.create({
          data: {
            file: uploaded.imageUrl,
            deleteUrl: uploaded.deleteUrl,
            subIndustryId: subIndustry.id,
            text: false,
          },
        })
        const calendarPost = await prisma.calendarPost.create({
          data: {
            userId,
            subIndustryId: subIndustry.id,
            contentId: savedContent.id,
            imageId: savedImage.id,
            type: 'IMAGE',
            postTime,
            status: 'SCHEDULED',
          },
        })
        onPost({
          index: globalIndex,
          post: { image: uploaded, text, hashtags, source: 'LLM', index: globalIndex },
          saved: { image: savedImage, calendarPost, content: savedContent },
        })
      }

      globalIndex++
    }
  }

  // ── Mode resolver ──────────────────────────────────────────────────────────

  private async resolveMode(
    industryId: string | undefined,
    subIndustryId: string | undefined,
    userPrompt: string
  ): Promise<ResolvedMode> {
    if (!industryId || !subIndustryId) {
      return { type: 'LLM_ONLY', context: 'general', industry: '', subIndustry: '' }
    }

    const [industry, subIndustry] = await Promise.all([
      prisma.industry.findUnique({ where: { id: industryId } }),
      prisma.subIndustry.findUnique({ where: { id: subIndustryId } }),
    ])

    if (!industry || !subIndustry) {
      throw new InternalServerErrorException('Invalid industry or sub-industry ID')
    }

    const dbImages = await prisma.image.findMany({
      where: { subIndustryId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    if (dbImages.length === 0) {
      return {
        type: 'LLM_ONLY',
        context: `${industry.name} - ${subIndustry.name}`,
        industry: industry.name,
        subIndustry: subIndustry.name,
      }
    }

    const data = await this.resolveBaseData(industry, subIndustry, dbImages, userPrompt)
    return { type: 'MIXED', data }
  }

  // ── Shared resolver ────────────────────────────────────────────────────────

private async resolveBaseData(
  industry: { id: string; name: string },
  subIndustry: { id: string; name: string },
  dbImages: any[],
  userPrompt: string
): Promise<BaseData> {
  // Batch into groups of 2 with delay between batches to avoid rate limit
  const textRaws: string[] = []
  const batchSize = 2
  const batchDelayMs = 1500

  for (let i = 0; i < 7; i += batchSize) {
    const batch = Array.from(
      { length: Math.min(batchSize, 7 - i) },
      (_, j) =>
        this.geminiService.generateText(
          buildPostTextPrompt(
            industry.name,
            subIndustry.name,
            `${userPrompt} (variation ${i + j + 1})`
          )
        )
    )
    const results = await Promise.all(batch)
    textRaws.push(...results)

    if (i + batchSize < 7) {
      await new Promise((res) => setTimeout(res, batchDelayMs))
    }
  }

  const textResults = textRaws.map((raw) => this.parseTextResult(raw))
  return { industry, subIndustry, dbImages, textResults }
}

  // ── LLM only streams ───────────────────────────────────────────────────────

  private async streamLLMOnly(
    userPrompt: string,
    industryName: string,
    subIndustryName: string,
    onPost: OnPost
  ): Promise<void> {
    const [textRaw1, textRaw2, llmImage1, llmImage2] = await Promise.all([
      this.geminiService.generateText(
        buildPostTextPrompt(industryName, subIndustryName, `${userPrompt} (variation 1)`)
      ),
      this.geminiService.generateText(
        buildPostTextPrompt(industryName, subIndustryName, `${userPrompt} (variation 2)`)
      ),
      this.generateAndUploadLLMImage(industryName, subIndustryName, userPrompt, 1),
      this.generateAndUploadLLMImage(industryName, subIndustryName, userPrompt, 2),
    ])

    const text1 = this.parseTextResult(textRaw1)
    const text2 = this.parseTextResult(textRaw2)

    onPost({
      index: 0,
      post: { image: llmImage1, text: text1.text, hashtags: text1.hashtags, source: 'LLM', index: 0 },
    })

    onPost({
      index: 1,
      post: { image: llmImage2, text: text2.text, hashtags: text2.hashtags, source: 'LLM', index: 1 },
    })
  }

  private async streamLLMOnlyAndSave(
    userId: string,
    subIndustryId: string | undefined,
    userPrompt: string,
    postTime: Date,
    industryName: string,
    subIndustryName: string,
    onPost: OnPost
  ): Promise<void> {
    const [textRaw1, textRaw2, llmImage1, llmImage2] = await Promise.all([
      this.geminiService.generateText(
        buildPostTextPrompt(industryName, subIndustryName, `${userPrompt} (variation 1)`)
      ),
      this.geminiService.generateText(
        buildPostTextPrompt(industryName, subIndustryName, `${userPrompt} (variation 2)`)
      ),
      this.generateAndUploadLLMImage(industryName, subIndustryName, userPrompt, 1),
      this.generateAndUploadLLMImage(industryName, subIndustryName, userPrompt, 2),
    ])

    const results: TextResult[] = [
      this.parseTextResult(textRaw1),
      this.parseTextResult(textRaw2),
    ]
    const images = [llmImage1, llmImage2]

    for (let i = 0; i < 2; i++) {
      const { text, hashtags } = results[i]

      const savedHashtags = await Promise.all(
        hashtags.map((tag) =>
          prisma.hashtag.upsert({ where: { tag }, update: {}, create: { tag } })
        )
      )

      const savedContent = await prisma.content.create({
        data: {
          text,
          subIndustryId: subIndustryId ?? '',
          hashtags: { create: savedHashtags.map((h) => ({ hashtagId: h.id })) },
        },
      })

      const savedImage = await prisma.image.create({
        data: {
          file: images[i].imageUrl,
          deleteUrl: images[i].deleteUrl,
          subIndustryId: subIndustryId ?? '',
          text: false,
        },
      })

      const calendarPost = await prisma.calendarPost.create({
        data: {
          userId,
          subIndustryId: subIndustryId ?? '',
          contentId: savedContent.id,
          imageId: savedImage.id,
          type: 'IMAGE',
          postTime,
          status: 'SCHEDULED',
        },
      })

      onPost({
        index: i,
        post: { image: images[i], text, hashtags, source: 'LLM', index: i },
        saved: { image: savedImage, calendarPost, content: savedContent },
      })
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async generateAndUploadLLMImage(
    industryName: string,
    subIndustryName: string,
    userPrompt: string,
    variation: number
  ): Promise<{ imageUrl: string; deleteUrl: string }> {
    const base64Images = await this.geminiService.generateImages(
      buildPostImagePrompt(industryName, subIndustryName, userPrompt, variation)
    )
    return this.uploadBase64Image(base64Images, `post_image_${variation}.png`)
  }

  private async uploadBase64Image(
    base64Images: string[],
    filename: string
  ): Promise<{ imageUrl: string; deleteUrl: string }> {
    if (!base64Images.length) {
      throw new InternalServerErrorException(`No image generated for ${filename}`)
    }
    const buffer = Buffer.from(base64Images[0], 'base64')
    const fakeFile: Express.Multer.File = {
      buffer,
      originalname: filename,
      mimetype: 'image/png',
      size: buffer.length,
    } as Express.Multer.File
    return this.imgbbService.uploadFile(fakeFile)
  }

  private parseTextResult(raw: string): TextResult {
    try {
      const clean = raw.replace(/```json|```/gi, '').trim()
      const parsed = JSON.parse(clean)
      return {
        text: parsed.text ?? '',
        hashtags: Array.isArray(parsed.hashtags)
          ? parsed.hashtags.map((h: string) => h.replace(/^#/, '').trim())
          : [],
      }
    } catch {
      return { text: raw.trim(), hashtags: [] }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

async generateTextStreamed(
  userPrompt: string,
  onPost: (event: { index: number; text: string }) => void
): Promise<void> {
  const variations = 5
  for (let i = 0; i < variations; i++) {
    const prompt = buildUserTextPrompt(`${userPrompt} (variation ${i + 1})`)
    const text = await this.geminiService.generateText(prompt)
    onPost({ index: i, text })
  }
}

  
}



