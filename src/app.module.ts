import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import  {CalendarModule } from './calendar/calendar.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { IndustriesModule } from './industries/industries.module'
import { ImagelayoutModule } from './imagelayout/imagelayout.module';
import { AuthModule } from './auth/auth.module'
import { ConfigModule } from '@nestjs/config'
import { BrevoModule } from './brevo/brevo.module';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from './users/user.module';
import { GeminiImageModule } from "./geminiimage/geminiimage.module";
import { FacebookModule } from './social-media/facebook/facebook.module';
import { JobsModule } from './jobs/jobs.module'
import {AutopostModule} from './outstand/autopost.module'
import { RagModule } from './rag/rag.module'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),ImagelayoutModule, FacebookModule,IndustriesModule, AuthModule,
    UserModule, BrevoModule,
      JwtModule.register({
      secret: process.env.JWT_SECRET, // must be defined in .env
      signOptions: { expiresIn: '8h' },
    }),
  SubscriptionModule,
  CalendarModule,
  GeminiImageModule,
  JobsModule,
  AutopostModule,
  RagModule,
],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
