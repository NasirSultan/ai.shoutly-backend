import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { HealthService } from './health.service'

// Public: polled by UptimeRobot every 5 minutes. Reports only up/down per
// dependency, never error details.
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.check()
    res.status(result.status === 'down' ? 503 : 200)
    res.setHeader('Cache-Control', 'no-store')
    return result
  }
}
