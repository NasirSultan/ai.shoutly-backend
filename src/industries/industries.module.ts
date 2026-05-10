import { ReelsModule } from './subindustries/reels/reels.module';
import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { IndustriesService } from './industries.service'
import { IndustriesController } from './industries.controller'
import { SubindustriesController } from './subindustries/subindustries.controller'
import { SubindustriesService } from './subindustries/subindustries.service'
import { ImagesController } from './images/images.controller'
import { DisplayImagesController } from './images/display-images.controller'
import { ImagesService } from './images/images.service'
import { RedisModule } from '../common/redis/redis.module'
import { ContentModule } from './subindustries/content/content.module';
// import { DriveImportModule } from './subindustries/drive-import/drive-import.module'

@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: 5 * 1024 * 1024 }, // optional limit 5MB
    }),RedisModule, ReelsModule,
    ContentModule
    // DriveImportModule 
  ],
  controllers: [IndustriesController, SubindustriesController, ImagesController,DisplayImagesController],
  providers: [IndustriesService, SubindustriesService, ImagesService],
})
export class IndustriesModule {}
