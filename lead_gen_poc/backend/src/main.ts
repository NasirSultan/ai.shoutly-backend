import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3100' })
  app.enableShutdownHooks()

  const port = process.env.PORT || 4100
  await app.listen(port)
  console.log(`Lead finder API on http://localhost:${port}/api (health: /api/health)`)
}

bootstrap()
