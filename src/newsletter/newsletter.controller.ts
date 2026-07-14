import { Controller, Post, Get, Delete, Body, Param, ValidationPipe, HttpCode, HttpStatus } from '@nestjs/common'
import { NewsletterService } from './newsletter.service'
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto'

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  subscribe(@Body(ValidationPipe) dto: SubscribeNewsletterDto) {
    return this.newsletterService.subscribe(dto)
  }

  @Get()
  findAll() {
    return this.newsletterService.findAll()
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  unsubscribe(@Body(ValidationPipe) dto: SubscribeNewsletterDto) {
    return this.newsletterService.unsubscribe(dto.email)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.newsletterService.remove(id)
  }
}
