import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { TemplateCreditService } from './template-credit.service';
import { GrantCreditsDto, RedeemCreditDto, SendCreditOtpDto, VerifyCreditOtpDto } from './dto/template-credit.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditLogService } from '../audit-log/audit-log.service';

@Controller('templates')
export class TemplateCreditController {
  constructor(
    private readonly templateCreditService: TemplateCreditService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Public (no login): prove the email with an OTP, then spend its credits.

  @Post('credits/send-otp')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  sendOtp(@Body() dto: SendCreditOtpDto) {
    return this.templateCreditService.sendOtp(dto.email);
  }

  @Post('credits/verify-otp')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  verifyOtp(@Body() dto: VerifyCreditOtpDto) {
    return this.templateCreditService.verifyOtp(dto.email, dto.otp);
  }

  @Get('credits/balance')
  balance(@Query('creditToken') creditToken: string) {
    return this.templateCreditService.getBalance(creditToken);
  }

  @Post('render/:renderId/redeem')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  redeem(@Param('renderId') renderId: string, @Body() dto: RedeemCreditDto) {
    return this.templateCreditService.redeem(renderId, dto.token, dto.creditToken);
  }

  // Admin (SUPERADMIN only).

  @Post('credits/admin/grant')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async grant(@Req() req, @Body() dto: GrantCreditsDto) {
    const result = await this.templateCreditService.grant(dto.email, dto.credits, req.user.id);
    this.auditLogService.log({
      actor: { id: req.user.id, email: req.user.email },
      action: 'TEMPLATE_CREDITS_GRANTED',
      targetType: 'TemplateCredit',
      targetId: result.email,
      after: { added: dto.credits, balance: result.balance },
    });
    return result;
  }

  @Get('credits/admin')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  list(@Query('page') page = '1', @Query('limit') limit = '20', @Query('search') search?: string) {
    return this.templateCreditService.list({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      search: search?.trim() || undefined,
    });
  }

  @Get('credits/admin/:email')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  history(@Param('email') email: string) {
    return this.templateCreditService.history(email);
  }
}
