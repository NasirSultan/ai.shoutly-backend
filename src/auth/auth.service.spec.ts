import { AuthService } from './auth.service'

describe('AuthService', () => {
  let service: AuthService
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } }
  let jwtService: { sign: jest.Mock }
  let redisService: { getClient: jest.Mock }
  let brevoService: { sendOtpEmail: jest.Mock }
  let twoFactorService: Record<string, never>
  let auditLogService: { log: jest.Mock }
  let redisClient: { get: jest.Mock; set: jest.Mock; del: jest.Mock }

  beforeEach(() => {
    redisClient = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() }
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } }
    jwtService = { sign: jest.fn().mockReturnValue('signed-token') }
    redisService = { getClient: jest.fn().mockReturnValue(redisClient) }
    brevoService = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) }
    twoFactorService = {}
    auditLogService = { log: jest.fn() }

    service = new AuthService(
      prisma as any,
      jwtService as any,
      redisService as any,
      brevoService as any,
      twoFactorService as any,
      auditLogService as any,
    )
  })

  describe('sendOtp — TC-014 (account-enumeration fix)', () => {
    it('returns the generic message and does NOT send an email for an unregistered address', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      const result = await service.sendOtp('nonexistent@example.com')

      expect(result).toEqual({ message: "If that email is registered, we've sent a verification code." })
      expect(prisma.user.update).not.toHaveBeenCalled()
      expect(brevoService.sendOtpEmail).not.toHaveBeenCalled()
    })

    it('returns the SAME generic message and DOES send an email for a registered address', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'real@example.com', name: 'Real User' })
      prisma.user.update.mockResolvedValue({})

      const result = await service.sendOtp('real@example.com')

      expect(result).toEqual({ message: "If that email is registered, we've sent a verification code." })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'real@example.com' } }),
      )
      expect(brevoService.sendOtpEmail).toHaveBeenCalledWith('real@example.com', 'Real User', expect.any(String))
    })

    it('registered and unregistered responses are indistinguishable', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null)
      const notFoundResult = await service.sendOtp('nonexistent@example.com')

      prisma.user.findUnique.mockResolvedValueOnce({ email: 'real@example.com', name: 'Real User' })
      prisma.user.update.mockResolvedValue({})
      const foundResult = await service.sendOtp('real@example.com')

      expect(notFoundResult).toEqual(foundResult)
    })
  })

  describe('login — generic error messages (closes the same enumeration gap)', () => {
    it('throws "Invalid email or password" for a non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.login('nonexistent@example.com', 'anything')).rejects.toMatchObject({
        message: 'Invalid email or password',
      })
    })

    it('throws "Invalid email or password" for an account with no password set (e.g. Google-only)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'real@example.com', password: null })

      await expect(service.login('real@example.com', 'anything')).rejects.toMatchObject({
        message: 'Invalid email or password',
      })
    })

    it('throws "Invalid email or password" for a wrong password on a real account', async () => {
      const bcrypt = require('bcrypt')
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false)
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'real@example.com',
        name: 'Real User',
        password: 'hashed',
      })

      await expect(service.login('real@example.com', 'wrong-password')).rejects.toMatchObject({
        message: 'Invalid email or password',
      })

      jest.restoreAllMocks()
    })

    it('all three failure paths produce the exact same message (no enumeration signal)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null)
      const noUserErr = await service.login('nonexistent@example.com', 'x').catch((e) => e)

      prisma.user.findUnique.mockResolvedValueOnce({ id: '1', email: 'real@example.com', password: null })
      const noPasswordErr = await service.login('real@example.com', 'x').catch((e) => e)

      const bcrypt = require('bcrypt')
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false)
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'real@example.com',
        name: 'Real User',
        password: 'hashed',
      })
      const wrongPasswordErr = await service.login('real@example.com', 'wrong').catch((e) => e)
      jest.restoreAllMocks()

      expect(noUserErr.message).toBe('Invalid email or password')
      expect(noPasswordErr.message).toBe('Invalid email or password')
      expect(wrongPasswordErr.message).toBe('Invalid email or password')
    })
  })
})
