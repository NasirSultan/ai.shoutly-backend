import { ForbiddenException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  templatePurchase: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
};
jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));
// The real ApplyLogoService pulls in ESM-only node-fetch; this suite passes a stub instead.
jest.mock('./apply-logo.service', () => ({ ApplyLogoService: class {} }));

import { TemplatePaymentService } from './template-payment.service';

describe('TemplatePaymentService', () => {
  let service: TemplatePaymentService;
  let paymentService: { createRazorpayOrder: jest.Mock; confirmCapturedPayment: jest.Mock };
  let applyLogoService: { verifyRenderToken: jest.Mock; getRenderImageUrl: jest.Mock; signDownloadToken: jest.Mock };

  const verifyDto = {
    razorpay_order_id: 'order_t1',
    razorpay_payment_id: 'pay_t1',
    razorpay_signature: 'sig',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    paymentService = { createRazorpayOrder: jest.fn(), confirmCapturedPayment: jest.fn() };
    applyLogoService = {
      verifyRenderToken: jest.fn(),
      getRenderImageUrl: jest.fn().mockResolvedValue('https://i.ibb.co/x.png'),
      signDownloadToken: jest.fn().mockReturnValue('paid-token'),
    };
    service = new TemplatePaymentService(paymentService as any, applyLogoService as any);
  });

  it('creates an order at the flat template price', async () => {
    mockPrisma.templatePurchase.findFirst.mockResolvedValue(null);
    paymentService.createRazorpayOrder.mockResolvedValue({
      keyId: 'rzp_test_key',
      order: { id: 'order_t1', amount: 2000, currency: 'INR' },
    });

    const res = await service.checkout('render-1', { token: 't', currency: 'INR' } as any);

    expect(paymentService.createRazorpayOrder).toHaveBeenCalledWith(20, 'INR', expect.any(String), { renderId: 'render-1' });
    expect(mockPrisma.templatePurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ renderId: 'render-1', imageUrl: 'https://i.ibb.co/x.png', amount: 20 }),
    });
    expect(res).toMatchObject({ alreadyPaid: false, orderId: 'order_t1', amount: 2000 });
  });

  it('does not charge twice for a render that is already paid', async () => {
    mockPrisma.templatePurchase.findFirst.mockResolvedValue({ id: 'p1', status: 'PAID' });

    const res = await service.checkout('render-1', { token: 't', currency: 'USD' } as any);

    expect(paymentService.createRazorpayOrder).not.toHaveBeenCalled();
    expect(res).toEqual({ alreadyPaid: true, downloadUrl: '/api/templates/render/render-1/download?token=paid-token' });
  });

  it('refuses checkout once the render has expired', async () => {
    mockPrisma.templatePurchase.findFirst.mockResolvedValue(null);
    applyLogoService.getRenderImageUrl.mockResolvedValue(null);

    await expect(service.checkout('render-1', { token: 't', currency: 'INR' } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('marks the purchase paid and returns a download link after a verified payment', async () => {
    mockPrisma.templatePurchase.findUnique.mockResolvedValue({ id: 'p1', renderId: 'render-1', amount: 20, status: 'CREATED' });

    const res = await service.verify('render-1', verifyDto);

    expect(paymentService.confirmCapturedPayment).toHaveBeenCalledWith(verifyDto, 20);
    expect(mockPrisma.templatePurchase.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { not: 'PAID' } },
      data: expect.objectContaining({ status: 'PAID', razorpayPaymentId: 'pay_t1' }),
    });
    expect(res.downloadUrl).toBe('/api/templates/render/render-1/download?token=paid-token');
  });

  it('does not unlock if payment confirmation fails', async () => {
    mockPrisma.templatePurchase.findUnique.mockResolvedValue({ id: 'p1', renderId: 'render-1', amount: 20, status: 'CREATED' });
    paymentService.confirmCapturedPayment.mockRejectedValue(new Error('Payment verification failed.'));

    await expect(service.verify('render-1', verifyDto)).rejects.toThrow('Payment verification failed.');
    expect(mockPrisma.templatePurchase.updateMany).not.toHaveBeenCalled();
  });

  it("rejects using one render's order to unlock a different render", async () => {
    mockPrisma.templatePurchase.findUnique.mockResolvedValue({ id: 'p1', renderId: 'render-1', amount: 20, status: 'PAID' });

    await expect(service.verify('render-2', verifyDto)).rejects.toBeInstanceOf(NotFoundException);
  });
});
