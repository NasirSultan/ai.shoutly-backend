import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'


async function bootstrap() {
  const app = await NestFactory.create(AppModule)
    app.setGlobalPrefix('api')

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  })

  const port = process.env.PORT || 3000

  const server = await app.listen(port, '0.0.0.0')
  server.setTimeout(300000)
  server.keepAliveTimeout = 300000

  console.log(`Server is running on port ${port}`)
  console.log(`Health check available at http://localhost:${port}/health`)
}

bootstrap()
