import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto'
import { prisma } from '../lib/prisma'

@Injectable()
export class NewsletterService {
  async subscribe(dto: SubscribeNewsletterDto) {
    const email = dto.email.trim().toLowerCase()
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })

    if (existing?.isActive) {
      throw new ConflictException('This email is already subscribed')
    }

    if (existing) {
      return prisma.newsletterSubscriber.update({
        where: { email },
        data: { isActive: true },
      })
    }

    return prisma.newsletterSubscriber.create({ data: { email } })
  }

  async findAll() {
    return prisma.newsletterSubscriber.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async unsubscribe(email: string) {
    const normalized = email.trim().toLowerCase()
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email: normalized } })
    if (!existing) throw new NotFoundException(`No subscriber found for ${email}`)

    return prisma.newsletterSubscriber.update({
      where: { email: normalized },
      data: { isActive: false },
    })
  }

  async remove(id: string) {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Subscriber ${id} not found`)

    await prisma.newsletterSubscriber.delete({ where: { id } })
    return { message: 'Subscriber removed successfully' }
  }
}
