import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { prisma } from '../../lib/prisma';

const ISSUER = 'ShoutlyAI';

@Injectable()
export class TwoFactorService {
  private prisma = prisma;

  async generateSetup(userId: string): Promise<{ secret: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const secret = authenticator.generateSecret();
    const otpauthUri = authenticator.keyuri(user.email, ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

    // Stored but not yet "enabled" until the user proves they can generate a
    // valid code — prevents an incomplete setup from locking anyone out.
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    return { secret, qrCodeDataUrl };
  }

  async verifyAndEnable(userId: string, code: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorSecret) throw new BadRequestException('Run 2FA setup first');

    const isValid = authenticator.verify({ token: code, secret: user.twoFactorSecret });
    if (!isValid) throw new BadRequestException('Invalid code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    return { success: true };
  }

  async disable(userId: string, code: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const isValid = authenticator.verify({ token: code, secret: user.twoFactorSecret });
    if (!isValid) throw new BadRequestException('Invalid code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    return { success: true };
  }

  async verifyLoginCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) return false;
    return authenticator.verify({ token: code, secret: user.twoFactorSecret });
  }
}
