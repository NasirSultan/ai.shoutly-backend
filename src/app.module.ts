import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import  {CalendarModule } from './calendar/calendar.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { IndustriesModule } from './industries/industries.module'
import { LogoOverlayModule } from './logo-overlay/logo-overlay.module';
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
import { ContactModule } from './contact/contact.module'
import { PostsModule } from './posts/posts.module'
import { FestivalsModule } from './festivals/festivals.module'
import { NotesModule } from './notes/notes.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { NewsletterModule } from './newsletter/newsletter.module'
import { AuditLogModule } from './audit-log/audit-log.module'
import { AiUsageLogModule } from './ai-usage/ai-usage-log.module'
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module'
import { IndustryRequestsModule } from './industry-requests/industry-requests.module'
import { BookDemoModule } from './book-demo/book-demo.module'
import { CalendarificModule } from './calendarific/calendarific.module'
import { WebsiteWatcherModule } from './website-watcher/website-watcher.module'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),LogoOverlayModule, FacebookModule,IndustriesModule, AuthModule,
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
  ContactModule,
  PostsModule,
  FestivalsModule,
  NotesModule,
  DashboardModule,
  NewsletterModule,
  AuditLogModule,
  AiUsageLogModule,
  AdminDashboardModule,
  IndustryRequestsModule,
  BookDemoModule,
  CalendarificModule,
  WebsiteWatcherModule,
],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
