import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { createHash } from 'crypto';

const tx = {
  templateCredit: { updateMany: jest.fn() },
  templatePurchase: { findFirst: jest.fn(), create: jest.fn() },
  templateCreditLog: { create: jest.fn() },
};
const mockPrisma = {
  templateCredit: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() },
  templateCreditLog: { create: jest.fn() },
  templatePurchase: { findFirst: jest.fn() },
  $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
};
jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('./apply-logo.service', () => ({ ApplyLogoService: class {} }));
jest.mock('../brevo/brevo.service', () => ({ BrevoService: class {} }));

import { TemplateCreditService, WELCOME_CREDITS } from './template-credit.service';

class FakeRedis {
  values = new Map<string, string>();
  client = {
    get: jest.fn(async (k: string) => this.values.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      this.values.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => (this.values.delete(k) ? 1 : 0)),
  };
  getClient() {
    return this.client;
  }
}

describe('TemplateCreditService', () => {
  let service: TemplateCreditService;
  let redis: FakeRedis;
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  let brevo: { sendOtpEmail: jest.Mock };
  let applyLogo: { verifyRenderToken: jest.Mock; getRenderImageUrl: jest.Mock; paidDownloadUrl: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    redis = new FakeRedis();
    jwt = { sign: jest.fn().mockReturnValue('credit-token'), verify: jest.fn() };
    brevo = { sendOtpEmail: jest.fn() };
    applyLogo = {
      verifyRenderToken: jest.fn(),
      getRenderImageUrl: jest.fn().mockResolvedValue('https://i.ibb.co/x.png'),
      paidDownloadUrl: jest.fn().mockReturnValue('/api/templates/render/r1/download?token=t'),
    };
    service = new TemplateCreditService(jwt as any, redis as any, brevo as any, applyLogo as any);
  });

  it('gives exactly 1 welcome credit', () => {
    expect(WELCOME_CREDITS).toBe(1);
  });

  it('emails an OTP and stores only its hash', async () => {
    await service.sendOtp('User@Example.com ');

    const otp = brevo.sendOtpEmail.mock.calls[0][2];
    expect(brevo.sendOtpEmail).toHaveBeenCalledWith('user@example.com', 'user', expect.stringMatching(/^\d{6}$/));
    expect(redis.values.get('template-credit:otp:user@example.com')).toBe(createHash('sha256').update(otp).digest('hex'));
  });

  it('creates a new account with the welcome credit on first verification', async () => {
    await service.sendOtp('new@example.com');
    const otp = brevo.sendOtpEmail.mock.calls[0][2];
    mockPrisma.templateCredit.findUnique.mockResolvedValue(null);
    mockPrisma.templateCredit.create.mockResolvedValue({ email: 'new@example.com', balance: 1 });

    const res = await service.verifyOtp('new@example.com', otp);

    expect(mockPrisma.templateCredit.create).toHaveBeenCalledWith({ data: { email: 'new@example.com', balance: 1 } });
    expect(res).toMatchObject({ email: 'new@example.com', balance: 1, creditToken: 'credit-token' });
  });

  it('does not give the welcome credit again to an existing email', async () => {
    await service.sendOtp('old@example.com');
    const otp = brevo.sendOtpEmail.mock.calls[0][2];
    mockPrisma.templateCredit.findUnique.mockResolvedValue({ email: 'old@example.com', balance: 0 });

    const res = await service.verifyOtp('old@example.com', otp);

    expect(mockPrisma.templateCredit.create).not.toHaveBeenCalled();
    expect(res.balance).toBe(0);
  });

  it('rejects a wrong OTP', async () => {
    await service.sendOtp('a@example.com');

    await expect(service.verifyOtp('a@example.com', '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('spends one credit to unlock a render', async () => {
    jwt.verify.mockReturnValue({ purpose: 'template-credit', email: 'a@example.com' });
    mockPrisma.templatePurchase.findFirst.mockResolvedValue(null);
    tx.templateCredit.updateMany.mockResolvedValue({ count: 1 });
    tx.templatePurchase.findFirst.mockResolvedValue(null);
    mockPrisma.templateCredit.findUnique.mockResolvedValue({ balance: 2 });

    const res = await service.redeem('r1', 'render-token', 'credit-token');

    expect(tx.templateCredit.updateMany).toHaveBeenCalledWith({
      where: { email: 'a@example.com', balance: { gte: 1 } },
      data: { balance: { decrement: 1 } },
    });
    expect(tx.templatePurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ renderId: 'r1', paidWith: 'CREDIT', email: 'a@example.com', status: 'PAID' }),
    });
    expect(res).toMatchObject({ unlocked: true, balance: 2, downloadUrl: '/api/templates/render/r1/download?token=t' });
  });

  it('returns 402 when the email has no credits left', async () => {
    jwt.verify.mockReturnValue({ purpose: 'template-credit', email: 'a@example.com' });
    mockPrisma.templatePurchase.findFirst.mockResolvedValue(null);
    tx.templateCredit.updateMany.mockResolvedValue({ count: 0 });

    const err = await service.redeem('r1', 'render-token', 'credit-token').catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(402);
    expect(tx.templatePurchase.create).not.toHaveBeenCalled();
  });

  it('does not spend a credit on a render that is already unlocked', async () => {
    jwt.verify.mockReturnValue({ purpose: 'template-credit', email: 'a@example.com' });
    mockPrisma.templatePurchase.findFirst.mockResolvedValue({ id: 'p1', status: 'PAID' });
    mockPrisma.templateCredit.findUnique.mockResolvedValue({ balance: 3 });

    const res = await service.redeem('r1', 'render-token', 'credit-token');

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(res.balance).toBe(3);
  });

  it('rejects a render token used as a credit token', async () => {
    jwt.verify.mockReturnValue({ purpose: 'render-download', renderId: 'r1' });

    await expect(service.redeem('r1', 'render-token', 'render-token')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin grant adds credits and logs who did it', async () => {
    mockPrisma.templateCredit.findUnique.mockResolvedValue({ email: 'a@example.com', balance: 1 });
    mockPrisma.templateCredit.update.mockResolvedValue({ email: 'a@example.com', balance: 11 });

    const res = await service.grant('A@example.com', 10, 'admin-1');

    expect(mockPrisma.templateCredit.update).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
      data: { balance: { increment: 10 } },
    });
    expect(mockPrisma.templateCreditLog.create).toHaveBeenCalledWith({
      data: { email: 'a@example.com', change: 10, reason: 'ADMIN_GRANT', adminId: 'admin-1' },
    });
    expect(res).toEqual({ email: 'a@example.com', balance: 11, added: 10 });
  });
});
