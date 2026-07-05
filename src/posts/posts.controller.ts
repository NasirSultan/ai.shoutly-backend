import { Controller, Get, Query } from '@nestjs/common'
import { PostsService } from './posts.service'

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  getPosts(
    @Query('page') page = '1',
    @Query('subIndustryId') subIndustryId?: string,
  ) {
    return this.postsService.getPosts({
      page: Math.min(6, Math.max(1, parseInt(page) || 1)),
      subIndustryId: subIndustryId?.trim() || undefined,
    })
  }
}
