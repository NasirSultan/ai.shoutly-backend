import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "crypto";
import { addMonths, addYears } from "date-fns";
import { PlanPrices, Billing } from "./subscription.constants";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";
import { prisma } from "../lib/prisma";

// Razorpay amounts are in the smallest currency unit (paise / cents).
const toMinorUnits = (amount: number) => Math.round(amount * 100);

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private client: Razorpay | null = null;

  private getCredentials() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new ServiceUnavailableException("Payments are not configured.");
    }
    return { keyId, keySecret };
  }

  private getClient() {
    const { keyId, keySecret } = this.getCredentials();
    this.client ??= new Razorpay({ key_id: keyId, key_secret: keySecret });
    return this.client;
  }

  private signatureMatches(payload: string | Buffer, secret: string, signature?: string) {
    if (!signature) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("hex"));
    const supplied = Buffer.from(signature);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  // Step 1: the price is decided here on the server, never taken from the client.
  async createOrder(userId: string, dto: CreateSubscriptionDto) {
    const { plan, billing, currency } = dto;
    const amount = PlanPrices[plan][currency][billing];
    const { keyId, order } = await this.createRazorpayOrder(amount, currency, `sub_${Date.now()}`, {
      userId,
      plan,
      billing,
    });

    await prisma.payment.create({
      data: {
        userId,
        razorpayOrderId: order.id,
        plan: plan as any,
        billing: billing as any,
        currency: currency as any,
        amount,
      },
    });

    return {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      plan,
      billing,
    };
  }

  // Shared by plan purchases and per-template purchases.
  async createRazorpayOrder(amount: number, currency: string, receipt: string, notes: Record<string, string>) {
    const { keyId } = this.getCredentials();
    const order = await this.getClient().orders.create({
      amount: toMinorUnits(amount),
      currency,
      receipt,
      notes,
    });
    return { keyId, order };
  }

  // Checks the Checkout signature and that Razorpay actually captured the
  // expected amount for this order. Throws if anything doesn't line up.
  async confirmCapturedPayment(dto: VerifyPaymentDto, expectedAmount: number) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = dto;

    const { keySecret } = this.getCredentials();
    if (!this.signatureMatches(`${razorpay_order_id}|${razorpay_payment_id}`, keySecret, razorpay_signature)) {
      throw new BadRequestException("Payment verification failed.");
    }

    // The signature proves Razorpay authorized this payment for this order;
    // also make sure the money was actually captured for the expected amount.
    const client = this.getClient();
    let rzpPayment = await client.payments.fetch(razorpay_payment_id);
    if (rzpPayment.order_id !== razorpay_order_id || Number(rzpPayment.amount) !== toMinorUnits(expectedAmount)) {
      throw new BadRequestException("Payment does not match this order.");
    }
    if (rzpPayment.status === "authorized") {
      rzpPayment = await client.payments.capture(razorpay_payment_id, rzpPayment.amount, rzpPayment.currency);
    }
    if (rzpPayment.status !== "captured") {
      throw new BadRequestException(`Payment is ${rzpPayment.status}, not captured.`);
    }
  }

  // Step 2: called by the frontend with what Razorpay Checkout's handler returns.
  async verifyCheckout(userId: string, dto: VerifyPaymentDto) {
    const { razorpay_order_id, razorpay_payment_id } = dto;

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId: razorpay_order_id },
    });
    if (!payment || payment.userId !== userId) {
      throw new NotFoundException("Order not found.");
    }

    await this.confirmCapturedPayment(dto, payment.amount);

    const subscription = await this.activate(payment.id, razorpay_payment_id);
    return { subscription, price: payment.amount, currency: payment.currency };
  }

  // Safe to call more than once for the same payment (checkout verify and the
  // webhook can race): only the first caller creates the subscription.
  private async activate(paymentId: string, razorpayPaymentId: string) {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: "PAID" } },
        data: { status: "PAID", razorpayPaymentId, paidAt: new Date(), failureReason: null },
      });
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { subscription: true },
      });
      if (claimed.count === 0) return payment.subscription;

      const now = new Date();
      const current = await tx.subscription.findFirst({
        where: { userId: payment.userId, isActive: true },
      });
      // Renewing the same paid plan early extends it from its current end
      // date instead of throwing away the days already paid for. Switching to
      // a different plan (upgrade/downgrade) starts the new plan right away.
      const base =
        current &&
        !current.isTrial &&
        current.plan === payment.plan &&
        current.expiresAt &&
        current.expiresAt > now
          ? current.expiresAt
          : now;
      const expiresAt = payment.billing === Billing.MONTHLY ? addMonths(base, 1) : addYears(base, 1);

      await tx.subscription.updateMany({
        where: { userId: payment.userId, isActive: true },
        data: { isActive: false },
      });

      const subscription = await tx.subscription.create({
        data: {
          userId: payment.userId,
          plan: payment.plan,
          billing: payment.billing,
          currency: payment.currency,
          amount: payment.amount,
          startedAt: now,
          expiresAt,
          isActive: true,
          isTrial: false,
        },
      });

      await tx.payment.update({
        where: { id: paymentId },
        data: { subscriptionId: subscription.id },
      });

      return subscription;
    });
  }

  // Backup path: activates the plan even if the user closed the tab before
  // the frontend could call verify.
  async handleWebhook(rawBody: Buffer, signature?: string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException("Webhook verification is not configured.");
    }
    if (!this.signatureMatches(rawBody, secret, signature)) {
      throw new BadRequestException("Invalid webhook signature.");
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const entity = event?.payload?.payment?.entity;
    if (!entity?.order_id) return { received: true };

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId: entity.order_id },
    });
    if (!payment) {
      const templatePurchase = await prisma.templatePurchase.findUnique({
        where: { razorpayOrderId: entity.order_id },
      });
      if (templatePurchase) {
        await this.handleTemplateWebhook(event.event, entity, templatePurchase);
        return { received: true };
      }
      this.logger.warn(`Webhook ${event.event} for unknown order ${entity.order_id}`);
      return { received: true };
    }

    switch (event.event) {
      case "payment.captured":
      case "order.paid":
        if (Number(entity.amount) !== toMinorUnits(payment.amount) || entity.currency !== payment.currency) {
          this.logger.error(`Amount mismatch on order ${entity.order_id}: got ${entity.amount} ${entity.currency}`);
          break;
        }
        await this.activate(payment.id, entity.id);
        break;
      case "payment.failed":
        await prisma.payment.updateMany({
          where: { id: payment.id, status: "CREATED" },
          data: { status: "FAILED", failureReason: entity.error_description ?? null },
        });
        break;
    }

    return { received: true };
  }

  private async handleTemplateWebhook(
    eventName: string,
    entity: any,
    purchase: { id: string; amount: number; currency: string },
  ) {
    switch (eventName) {
      case "payment.captured":
      case "order.paid":
        if (Number(entity.amount) !== toMinorUnits(purchase.amount) || entity.currency !== purchase.currency) {
          this.logger.error(`Amount mismatch on template order ${entity.order_id}: got ${entity.amount} ${entity.currency}`);
          return;
        }
        await prisma.templatePurchase.updateMany({
          where: { id: purchase.id, status: { not: "PAID" } },
          data: { status: "PAID", razorpayPaymentId: entity.id, paidAt: new Date() },
        });
        return;
      case "payment.failed":
        await prisma.templatePurchase.updateMany({
          where: { id: purchase.id, status: "CREATED" },
          data: { status: "FAILED" },
        });
        return;
    }
  }
}
