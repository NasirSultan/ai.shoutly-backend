import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', apifyMock: process.env.APIFY_MOCK === 'true' }
  }
}
