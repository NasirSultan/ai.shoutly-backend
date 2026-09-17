import './instrumentation'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import * as path from 'path'
import dotenv from 'dotenv'
import { langfuseSpanProcessor } from './instrumentation'
dotenv.config()

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  app.useStaticAssets(path.join(__dirname, '..', 'public'))
  app.setGlobalPrefix('api')

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  })

  const port = process.env.PORT || 3000

  const server = await app.listen(port)
  server.setTimeout(300000)
  server.keepAliveTimeout = 300000

  console.log(`Server is running on port ${port}`)
  console.log(`Health check available at http://localhost:${port}/health`)

  const flushLangfuseAndExit = async () => {
    await langfuseSpanProcessor.forceFlush().catch(() => undefined)
    process.exit(0)
  }

  process.on('SIGTERM', flushLangfuseAndExit)
  process.on('SIGINT', flushLangfuseAndExit)
}

bootstrap()
