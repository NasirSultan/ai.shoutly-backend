import { Controller, Post, Req, Get,UseGuards,Param, UseInterceptors,Patch, UploadedFile, Body } from '@nestjs/common'
import { CalendarService } from './calendar.service'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { ImgbbService } from '../lib/imgbb/imgbb.service'
import { FileInterceptor } from '@nestjs/platform-express'
import { Express } from 'express'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService,
        private readonly imgbbService: ImgbbService,
        private readonly auditLogService: AuditLogService
  ) {}

  @UseGuards(AuthGuard)
  @Post('plan')
  async createMonthlyPlan(
    @Req() req,
    @Body() body: { postTime: string }
  ) {
    const userId = req.user.id

    const result = await this.calendarService.generatePlan(userId, body.postTime)

    this.auditLogService.log({
      actor: { id: userId, email: req.user.email },
      action: 'CALENDAR_PLAN_GENERATED',
      targetType: 'User',
      targetId: userId,
    })

    return result
  }

// calendar.controller.ts
@UseGuards(AuthGuard)
@Get('plan')
async getUserPlan(@Req() req) {
  const userId = req.user.id
  return await this.calendarService.getPlanByUser(userId)
}

// Admin variant of GET /calendar/plan — fetches the current calendar plan
// for any user by userId instead of the caller's own token.
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
@Get('admin/:userId/plan')
async getUserPlanForAdmin(@Param('userId') userId: string) {
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

  const result = await this.calendarService.updatePost(userId, postId, body, imageData)

  this.auditLogService.log({
    actor: { id: userId, email: req.user.email },
    action: 'CALENDAR_POST_UPDATED',
    targetType: 'CalendarPost',
    targetId: postId,
  })

  return result
}

@Post('post')
@UseGuards(AuthGuard)
@UseInterceptors(FileInterceptor('image'))
async createPost(
  @Req() req,
  @Body() body: { subIndustryId: string; postTime: string; contentText?: string; imageUrl?: string; timezone?: string },
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

  const result = await this.calendarService.createPost(
    userId,
    body,
    imageData
  )

  this.auditLogService.log({
    actor: { id: userId, email: req.user.email },
    action: 'CALENDAR_POST_CREATED',
    targetType: 'CalendarPost',
    targetId: result?.post?.postId ?? '',
  })

  return result
}

@UseGuards(AuthGuard)
@Post('post/:postId/publish')
async publishNow(@Req() req, @Param('postId') postId: string) {
  const userId = req.user.id
  const result = await this.calendarService.publishNow(userId, postId)

  this.auditLogService.log({
    actor: { id: userId, email: req.user.email },
    action: 'CALENDAR_POST_PUBLISHED',
    targetType: 'CalendarPost',
    targetId: postId,
  })

  return result
}

// User-only "manual" post endpoints — separate from POST/PATCH /calendar/post
// so those existing routes stay completely untouched. See createManualPost's
// comment in calendar.service.ts for why this isolation exists.
@Post('post/manual')
@UseGuards(AuthGuard)
@UseInterceptors(FileInterceptor('image'))
async createManualPost(
  @Req() req,
  @Body() body: { postTime: string; contentText?: string; imageUrl?: string; timezone?: string },
  @UploadedFile() file?: Express.Multer.File
) {
  const userId = req.user.id

  let imageData
  if (body.imageUrl) {
    imageData = { imageUrl: body.imageUrl, deleteUrl: '' }
  } else if (file) {
    imageData = await this.imgbbService.uploadFile(file)
  }

  const result = await this.calendarService.createManualPost(userId, body, imageData)

  this.auditLogService.log({
    actor: { id: userId, email: req.user.email },
    action: 'CALENDAR_POST_CREATED',
    targetType: 'CalendarPost',
    targetId: result?.post?.postId ?? '',
    after: { manual: true },
  })

  return result
}

@UseGuards(AuthGuard)
@Patch('post/manual/:postId')
@UseInterceptors(FileInterceptor('image'))
async updateManualPost(
  @Req() req,
  @Param('postId') postId: string,
  @Body() body: { postTime?: string; status?: string; contentText?: string; reelId?: string; imageUrl?: string; timezone?: string },
  @UploadedFile() file?: Express.Multer.File
) {
  const userId = req.user.id

  let imageData
  if (body.imageUrl) {
    imageData = { imageUrl: body.imageUrl, deleteUrl: '' }
  } else if (file) {
    imageData = await this.imgbbService.uploadFile(file)
  }

  const result = await this.calendarService.updateManualPost(userId, postId, body, imageData)

  this.auditLogService.log({
    actor: { id: userId, email: req.user.email },
    action: 'CALENDAR_POST_UPDATED',
    targetType: 'CalendarPost',
    targetId: postId,
    after: { manual: true },
  })

  return result
}

}