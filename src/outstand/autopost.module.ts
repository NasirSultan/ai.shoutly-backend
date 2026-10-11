import { Module } from '@nestjs/common';
import { AutopostService } from './autopost.service';
import { AutopostController } from './autopost.controller';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../common/redis/redis.module';
import { LinkedInModule } from '../social-media/linkedin/linkedin.module';
import { YoutubeModule } from '../social-media/youtube/youtube.module';
import { GoogleBusinessModule } from '../social-media/google-business/google-business.module';

@Module({
  imports: [AuthModule, RedisModule, LinkedInModule, YoutubeModule, GoogleBusinessModule],
  controllers: [AutopostController],
  providers: [AutopostService],
  exports: [AutopostService],
})
export class AutopostModule {}