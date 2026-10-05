import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentService } from '../subscription/payment.service';
import { VerifyPaymentDto } from '../subscription/dto/verify-payment.dto';
import { prisma } from '../lib/prisma';
import { ApplyLogoService } from './apply-logo.service';
import { TemplateCheckoutDto } from './dto/template-checkout.dto';
import { getTemplatePrice } from './template-pricing';

// How long the download link stays valid after paying (matches ApplyLogoService.paidDownloadUrl).
const PAID_DOWNLOAD_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class TemplatePaymentService {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly applyLogoService: ApplyLogoService,
  ) {}

  // Step 1: create a Razorpay order for one rendered template.
  async checkout(renderId: string, dto: TemplateCheckoutDto) {
    this.applyLogoService.verifyRenderToken(renderId, dto.token);

    const alreadyPaid = await prisma.templatePurchase.findFirst({ where: { renderId, status: 'PAID' } });
    if (alreadyPaid) {
      return { alreadyPaid: true, downloadUrl: this.applyLogoService.paidDownloadUrl(renderId) };
    }

    const imageUrl = await this.applyLogoService.getRenderImageUrl(renderId);
    if (!imageUrl) throw new ForbiddenException('Render expired. Please apply the template again.');

    const amount = getTemplatePrice(dto.currency);
    const { keyId, order } = await this.paymentService.createRazorpayOrder(
      amount,
      dto.currency,
      `tpl_${Date.now()}`,
      { renderId },
    );

    await prisma.templatePurchase.create({
      data: {
        renderId,
        imageUrl,
        razorpayOrderId: order.id,
        amount,
        currency: dto.currency as any,
      },
    });

    return {
      alreadyPaid: false,
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    };
  }

  // Step 2: confirm the payment and hand back a download link.
  async verify(renderId: string, dto: VerifyPaymentDto) {
    const purchase = await prisma.templatePurchase.findUnique({
      where: { razorpayOrderId: dto.razorpay_order_id },
    });
    if (!purchase || purchase.renderId !== renderId) {
      throw new NotFoundException('Order not found.');
    }

    if (purchase.status !== 'PAID') {
      await this.paymentService.confirmCapturedPayment(dto, purchase.amount);
      await prisma.templatePurchase.updateMany({
        where: { id: purchase.id, status: { not: 'PAID' } },
        data: { status: 'PAID', razorpayPaymentId: dto.razorpay_payment_id, paidAt: new Date() },
      });
    }

    return { paid: true, downloadUrl: this.applyLogoService.paidDownloadUrl(renderId), expiresIn: PAID_DOWNLOAD_TTL_SECONDS };
  }
}
