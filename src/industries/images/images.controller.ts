import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  Param,
  Query,
  Get,
  Delete,
  Patch
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { ImagesService } from './images.service'
import { Express } from 'express'

@Controller('subindustries/:subIndustryId/images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) { }

  @Post('multiple')
  @UseInterceptors(
    FilesInterceptor('files', 31, {
      limits: { fileSize: 50 * 1024 * 1024 }
    })
  )


  async uploadMultiple(
    @Param('subIndustryId') subIndustryId: string,
    @Query('text') text: string,
    @UploadedFiles() files: Express.Multer.File[]
  ) {
    if (!files || files.length === 0) {
      return { success: false, message: 'No files uploaded' }
    }

    const isText = text === 'true'

    return this.imagesService.createMultipleSafe(
      files,
      subIndustryId,
      isText
    )
  }

  @Get()
  async findAll(@Param('subIndustryId') subIndustryId: string) {
    return this.imagesService.findAll(subIndustryId)
  }

  @Get('grouped')
  async getGroupedImages(@Param('subIndustryId') subIndustryId: string) {
    return this.imagesService.findGroupedByText(subIndustryId)
  }



  
  @Get('deleted')
  async getDeletedImages(@Param('subIndustryId') subIndustryId: string) {
    return this.imagesService.getDeletedImages(subIndustryId)
  }

  @Patch('restore/all')
  async restoreAllImages(@Param('subIndustryId') subIndustryId: string) {
    return this.imagesService.restoreAllImages(subIndustryId)
  }

  @Patch('restore/:imageId')
  async restoreImage(@Param('imageId') imageId: string) {
    return this.imagesService.restoreImage(imageId)
  }

  @Delete('all')
  async deleteAllImages() {
    return this.imagesService.deleteAllImages()
  }

  @Delete()
  async deleteImages(
    @Param('subIndustryId') subIndustryId: string,
    @Query('text') text: string
  ) {
    return this.imagesService.deleteBySubIndustryAndText(
      subIndustryId,
      text === 'true'
    )
  }
}
