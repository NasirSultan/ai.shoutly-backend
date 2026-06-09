import { Controller, Post, Req, Get,UseGuards,Param, UseInterceptors,Patch, UploadedFile, Body } from '@nestjs/common'
import { CalendarService } from './calendar.service'
import { AuthGuard } from '../common/guards/auth.guard'
import { ImgbbService } from '../lib/imgbb/imgbb.service'
import { FileInterceptor } from '@nestjs/platform-express'
import { Express } from 'express'

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService,
        private readonly imgbbService: ImgbbService
  ) {}

  @UseGuards(AuthGuard)
  @Post('plan')
  async createMonthlyPlan(
    @Req() req,
    @Body() body: { prompt: string; subIndustries: string[]; postTime: string }
  ) {
    const userId = req.user.id
    const { prompt, subIndustries, postTime } = body

    return await this.calendarService.generatePlan(
      userId,
      prompt,
      subIndustries,
      postTime
    )
  }

// calendar.controller.ts
@UseGuards(AuthGuard)
@Get('plan')
async getUserPlan(@Req() req) {
  const userId = req.user.id
  return await this.calendarService.getPlanByUser(userId)
}



  @UseGuards(AuthGuard)
  @Get('post/:postId')
  async getPostById(@Req() req, @Param('postId') postId: string) {
    const userId = req.user.id
    return await this.calendarService.getPostDetails(userId, postId)
  }


@UseGuards(AuthGuard)
@Patch('post/:postId')
@UseInterceptors(FileInterceptor('image'))
async updateCalendarPost(
  @Req() req,
  @Param('postId') postId: string,
  @Body() body: { postTime?: string; status?: string; contentText?: string; reelId?: string; imageUrl?: string, timezone?: string },
  @UploadedFile() file?: Express.Multer.File
) {
  const userId = req.user.id

  let imageData

  if (body.imageUrl) {
    imageData = {
      imageUrl: body.imageUrl,
      deleteUrl: ''
    }
  } else if (file) {
    imageData = await this.imgbbService.uploadFile(file)
  }

  return await this.calendarService.updatePost(userId, postId, body, imageData)
}

@Post('post')
@UseGuards(AuthGuard)
@UseInterceptors(FileInterceptor('image'))
async createPost(
  @Req() req,
  @Body() body: { subIndustryId: string; postTime: string; contentText?: string; imageUrl?: string },
  @UploadedFile() file?: Express.Multer.File
) {
  const userId = req.user.id

  let imageData

  if (body.imageUrl) {
    imageData = {
      imageUrl: body.imageUrl,
      deleteUrl: ''
    }
  } else if (file) {
    imageData = await this.imgbbService.uploadFile(file)
  }

  return await this.calendarService.createPost(
    userId,
    body,
    imageData
  )
}

}