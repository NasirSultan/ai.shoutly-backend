import { Body, Controller, Get, Param, Post, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { ApplyLogoService } from './apply-logo.service';
import { ApplyLogoDto } from './dto/apply-logo.dto';

@Controller('templates')
export class ApplyLogoController {
  constructor(private readonly applyLogoService: ApplyLogoService) {}

  @Post('apply-logo')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  apply(@Body() dto: ApplyLogoDto) {
    return this.applyLogoService.apply(dto);
  }

  @Get('render/:renderId')
  async preview(@Param('renderId') renderId: string, @Query('token') token: string, @Res() res: Response) {
    await this.applyLogoService.streamRender(renderId, token, false, res);
  }

  @Get('render/:renderId/download')
  async download(@Param('renderId') renderId: string, @Query('token') token: string, @Res() res: Response) {
    await this.applyLogoService.streamRender(renderId, token, true, res);
  }
}
