// geminiimage.controller.ts

import { Controller, Post, Body, Res } from '@nestjs/common'
import { Response } from 'express'
import { PostGeneratorService, StreamEvent } from './geminiimage.service'

@Controller('generator')
export class PostGeneratorController {
  constructor(private readonly postGeneratorService: PostGeneratorService) {}

  @Post('posts')
  async generate(
    @Body('subIndustryId') subIndustryId: string | undefined,
    @Body('prompt') prompt: string
  ) {
    return this.postGeneratorService.generateMixedPosts(subIndustryId, prompt)
  }

  @Post('generate-and-save')
  async generateAndSave(
    @Body('userId') userId: string,
    @Body('industryId') industryId: string | undefined,
    @Body('subIndustryId') subIndustryId: string | undefined,
    @Body('prompt') prompt: string,
    @Body('postTime') postTime: string,
    @Res() res: Response
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    await this.postGeneratorService.generateMixedAndSavePostsStreamed(
      userId,
      industryId,
      subIndustryId,
      prompt,
      new Date(postTime),
      (event: StreamEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    )

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()
  }


@Post('texts')
async generateText(
  @Body('prompt') prompt: string,
  @Res() res: Response
) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  await this.postGeneratorService.generateTextStreamed(prompt, (event) => {
    res.write(`data: ${JSON.stringify({ text: event.text })}\n\n`)
  })

  res.end()
}

@Post('hashtags')
async generateHashtags(
  @Body('caption') caption: string,
  @Res() res: Response
) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  await this.postGeneratorService.generateHashtagsStreamed(caption, (event) => {
    res.write(`data: ${JSON.stringify({ hashtags: event.hashtags })}\n\n`)
  })

  res.end()
}

}