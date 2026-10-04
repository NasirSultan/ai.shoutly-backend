import { IsString, IsNotEmpty } from "class-validator";

// Field names match what Razorpay Checkout passes to its success handler.
export class VerifyPaymentDto {
  @IsString()
  @IsNotEmpty()
  razorpay_order_id: string;

  @IsString()
  @IsNotEmpty()
  razorpay_payment_id: string;

  @IsString()
  @IsNotEmpty()
  razorpay_signature: string;
}
