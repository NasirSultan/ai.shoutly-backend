import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
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
}
