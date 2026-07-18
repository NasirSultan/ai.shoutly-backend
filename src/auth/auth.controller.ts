import { Controller, Post, Body ,UploadedFile, UseInterceptors } from '@nestjs/common'
import { AuthService } from './auth.service'
import { FileInterceptor } from '@nestjs/platform-express'
import { RegisterDto } from './dto/register.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { SetPasswordDto } from './dto/set-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshTokenDto } from './dto/refresh-token.dto'
import { Express } from 'express'
import { ImgbbService } from '../lib/imgbb/imgbb.service'

@Controller('auth')
export class AuthController {
  constructor(
      private authService: AuthService ,
      private readonly imgbbService: ImgbbService
  ) {}

@Post('register')
async register(@Body() dto: RegisterDto) {
  return this.authService.register(dto.name, dto.email, dto.role)
}


  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.otp)
  }

  @Post('set-password')
  async setPassword(@Body() dto: SetPasswordDto) {
    return this.authService.setPassword(dto.email, dto.password)
  }

 @Post('set-profile')
  @UseInterceptors(FileInterceptor('brandLogo'))
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: Express.Multer.File
  ) {
    let brandLogoUrl: string | undefined

    if (file) {
      const uploaded = await this.imgbbService.uploadBrandLogo(file)
      brandLogoUrl = uploaded
    }

    return this.authService.updateProfile(dto.email, {
      ...dto,
      brandLogo: brandLogoUrl
    })
  }

@Post('login')
async login(@Body() dto: LoginDto) {
  return this.authService.login(dto.email, dto.password)
}

@Post('2fa/login-verify')
async verifyTwoFactorLogin(@Body() body: { pendingToken: string; code: string }) {
  return this.authService.verifyTwoFactorLogin(body.pendingToken, body.code)
}

@Post('refresh-token')
async refresh(@Body() dto: RefreshTokenDto) {
  return this.authService.refreshToken(dto.refreshToken)
}

  @Post('send-otp')
  async sendOtp(@Body() body: { email: string }) {
    return this.authService.sendOtp(body.email)
  }

  @Post('verify-otp-reset')
  async verifyOtpReset(@Body() body: { email: string, otp: string }) {
    return this.authService.verifyOtpForReset(body.email, body.otp)
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { email: string, password: string }) {
    return this.authService.resetPassword(body.email, body.password)
  }
}
