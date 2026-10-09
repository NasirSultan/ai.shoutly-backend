import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { ApplyLogoService } from './apply-logo.service';
import { ApplyLogoDto } from './dto/apply-logo.dto';
import { TemplateCheckoutDto } from './dto/template-checkout.dto';
import { TemplatePaymentService } from './template-payment.service';
import { VerifyPaymentDto } from '../subscription/dto/verify-payment.dto';
import { AuthGuard } from '../common/guards/auth.guard';

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

  // Same render for signed-in users on a paid plan (dashboard Brand Settings):
  // no PREVIEW watermark, and the response includes a ready downloadUrl.
  // The public /templates flow keeps using apply-logo + payment/credits.
  @Post('apply-logo/subscriber')
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async applyForSubscriber(@Req() req, @Body() dto: ApplyLogoDto) {
    if (!(await this.applyLogoService.isPaidSubscriber(req.user.id))) {
      throw new ForbiddenException('A paid plan is required for watermark-free renders');
    }
    return this.applyLogoService.apply(dto, { entitled: true });
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
