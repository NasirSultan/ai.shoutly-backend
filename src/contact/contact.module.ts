import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { ContactController } from './contact.controller'
import { ContactService } from './contact.service'
import { ContactBodySizeMiddleware } from './contact-body-size.middleware'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContactBodySizeMiddleware).forRoutes({ path: 'contact', method: RequestMethod.POST })
  }
}
