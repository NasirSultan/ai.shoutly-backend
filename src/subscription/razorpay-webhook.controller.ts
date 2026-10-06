import { Controller, Post, Req, Headers, HttpCode, HttpStatus } from "@nestjs/common";
import { PaymentService } from "./payment.service";

// Public route (no AuthGuard) — Razorpay calls it directly. Authenticity is
// checked via the X-Razorpay-Signature HMAC over the raw body.
@Controller("subscription/webhook")
export class RazorpayWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post("razorpay")
  @HttpCode(HttpStatus.OK)
  async razorpay(@Req() req, @Headers("x-razorpay-signature") signature: string | undefined) {
    return this.paymentService.handleWebhook(req.rawBody, signature);
  }
}
