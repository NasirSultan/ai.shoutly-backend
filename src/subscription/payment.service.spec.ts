import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHmac } from "crypto";

const tx = {
  payment: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  subscription: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
};
const mockPrisma = {
  payment: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn((fn) => fn(tx)),
};
jest.mock("../lib/prisma", () => ({ prisma: mockPrisma }));

import { PaymentService } from "./payment.service";

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("hex");

const pendingPayment = {
  id: "pay-row-1",
  userId: "user-1",
  razorpayOrderId: "order_1",
  billing: "MONTHLY",
  currency: "INR",
  amount: 10000,
  status: "CREATED",
};

describe("PaymentService", () => {
  let service: PaymentService;
  let rzp: { payments: { fetch: jest.Mock; capture: jest.Mock }; orders: { create: jest.Mock } };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "key-secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
    service = new PaymentService();
    rzp = {
      orders: { create: jest.fn() },
      payments: { fetch: jest.fn(), capture: jest.fn() },
    };
    (service as any).client = rzp;
  });

  it("creates the order with the server-side price, not a client amount", async () => {
    rzp.orders.create.mockResolvedValue({ id: "order_1", amount: 1000000, currency: "INR" });

    const res = await service.createOrder("user-1", { billing: "MONTHLY", currency: "INR" } as any);

    expect(rzp.orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000000, currency: "INR" }));
    expect(res).toMatchObject({ keyId: "rzp_test_key", orderId: "order_1", amount: 1000000 });
  });

  it("rejects a forged checkout signature", async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);

    await expect(
      service.verifyCheckout("user-1", {
        razorpay_order_id: "order_1",
        razorpay_payment_id: "pay_1",
        razorpay_signature: "forged",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects verifying another user's order", async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);

    await expect(
      service.verifyCheckout("user-2", {
        razorpay_order_id: "order_1",
        razorpay_payment_id: "pay_1",
        razorpay_signature: sign("order_1|pay_1", "key-secret"),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("activates the plan once a valid, captured payment is verified", async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);
    rzp.payments.fetch.mockResolvedValue({ order_id: "order_1", amount: 1000000, currency: "INR", status: "captured" });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.payment.findUniqueOrThrow.mockResolvedValue({ ...pendingPayment, subscription: null });
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.subscription.create.mockResolvedValue({ id: "sub-1" });

    const res = await service.verifyCheckout("user-1", {
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: sign("order_1|pay_1", "key-secret"),
    });

    expect(res.subscription).toEqual({ id: "sub-1" });
    expect(tx.subscription.create).toHaveBeenCalledTimes(1);
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: "pay-row-1" }, data: { subscriptionId: "sub-1" } });
  });

  it("does not create a second subscription when the payment was already activated", async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    tx.payment.findUniqueOrThrow.mockResolvedValue({ ...pendingPayment, status: "PAID", subscription: { id: "sub-1" } });
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 1000000, currency: "INR" } } },
    });

    await service.handleWebhook(Buffer.from(body), sign(body, "webhook-secret"));

    expect(tx.subscription.create).not.toHaveBeenCalled();
  });

  it("rejects a webhook with a bad signature", async () => {
    await expect(service.handleWebhook(Buffer.from("{}"), "bad")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ignores a webhook whose amount does not match the order", async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment);
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 100, currency: "INR" } } },
    });

    await service.handleWebhook(Buffer.from(body), sign(body, "webhook-secret"));

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
