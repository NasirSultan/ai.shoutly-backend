import { Body, Controller, Get, Param, Post, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { ApplyLogoService } from './apply-logo.service';
import { ApplyLogoDto } from './dto/apply-logo.dto';
import { TemplateCheckoutDto } from './dto/template-checkout.dto';
import { TemplatePaymentService } from './template-payment.service';
import { VerifyPaymentDto } from '../subscription/dto/verify-payment.dto';

@Controller('templates')
export class ApplyLogoController {
  constructor(
    private readonly applyLogoService: ApplyLogoService,
    private readonly templatePaymentService: TemplatePaymentService,
  ) {}

  @Post('apply-logo')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  apply(@Body() dto: ApplyLogoDto) {
    return this.applyLogoService.apply(dto);
  }

  // Pay-per-template: step 1 creates a Razorpay order for this render.
  @Post('render/:renderId/checkout')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  checkout(@Param('renderId') renderId: string, @Body() dto: TemplateCheckoutDto) {
    return this.templatePaymentService.checkout(renderId, dto);
  }

  // Pay-per-template: step 2 confirms the payment and returns the download link.
  @Post('render/:renderId/verify')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  verify(@Param('renderId') renderId: string, @Body() dto: VerifyPaymentDto) {
    return this.templatePaymentService.verify(renderId, dto);
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
