import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { DateTime } from 'luxon'
import { DemoBookingStatus } from '@prisma/client'
import { CreateBookDemoDto } from './dto/create-book-demo.dto'
import { UpdateBookDemoStatusDto } from './dto/update-book-demo-status.dto'
import { prisma } from '../lib/prisma'

const TIMEZONE = 'Asia/Kolkata'
const START_HOUR = 10
const END_HOUR = 18
const BOOKABLE_WEEKDAYS = [1, 2, 3, 4, 5] // Luxon: Mon=1 ... Sun=7

@Injectable()
export class BookDemoService {
  private isValidSlotTime(dt: DateTime): boolean {
    if (!dt.isValid) return false
    if (dt < DateTime.now().setZone(TIMEZONE)) return false
    if (!BOOKABLE_WEEKDAYS.includes(dt.weekday)) return false
    if (dt.second !== 0 || dt.millisecond !== 0) return false
    if (dt.minute !== 0 && dt.minute !== 30) return false
    if (dt.hour < START_HOUR || dt.hour >= END_HOUR) return false
    return true
  }

  private buildWeekSlots(weekAnchor: DateTime): DateTime[] {
    const monday = weekAnchor.startOf('week')
    const slots: DateTime[] = []

    for (const weekday of BOOKABLE_WEEKDAYS) {
      const day = monday.plus({ days: weekday - 1 })
      for (let hour = START_HOUR; hour < END_HOUR; hour++) {
        for (const minute of [0, 30]) {
          slots.push(day.set({ hour, minute, second: 0, millisecond: 0 }))
        }
      }
    }

    return slots
  }

  async getAvailableSlots(week?: string) {
    const anchor = week
      ? DateTime.fromISO(week, { zone: TIMEZONE })
      : DateTime.now().setZone(TIMEZONE)

    if (!anchor.isValid) {
      throw new BadRequestException('Invalid week date. Use format YYYY-MM-DD.')
    }

    const now = DateTime.now().setZone(TIMEZONE)
    const allSlots = this.buildWeekSlots(anchor).filter((slot) => slot > now)

    if (!allSlots.length) return []

    const existing = await prisma.demoBooking.findMany({
      where: { slotTime: { in: allSlots.map((s) => s.toUTC().toJSDate()) } },
      select: { slotTime: true },
    })
    const takenTimes = new Set(existing.map((b) => b.slotTime.toISOString()))

    return allSlots.map((slot) => ({
      slotTime: slot.toUTC().toISO(),
      display: `${slot.toFormat('cccc, dd LLL yyyy, hh:mm a')} IST`,
      booked: takenTimes.has(slot.toUTC().toJSDate().toISOString()),
    }))
  }

  async create(dto: CreateBookDemoDto) {
    const requested = DateTime.fromISO(dto.slotTime, { setZone: true }).setZone(TIMEZONE)

    if (!this.isValidSlotTime(requested)) {
      throw new BadRequestException(
        'Selected slot is invalid. Slots run Mon–Fri, 10:00–18:00 IST in 30-minute increments, and must be in the future.',
      )
    }

    try {
      return await prisma.demoBooking.create({
        data: {
          fullName: dto.fullName,
          businessName: dto.businessName,
          email: dto.email,
          phone: dto.phone,
          slotTime: requested.toUTC().toJSDate(),
          message: dto.message,
        },
      })
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('This slot is already booked. Please choose another.')
      }
      throw err
    }
  }

  async findAll() {
    return prisma.demoBooking.findMany({ orderBy: { slotTime: 'asc' } })
  }

  // Admin view: every booking (any status) for a given Mon–Sun week, paginated.
  async getWeekBookings(week: string | undefined, page: number, limit: number) {
    const anchor = week
      ? DateTime.fromISO(week, { zone: TIMEZONE })
      : DateTime.now().setZone(TIMEZONE)

    if (!anchor.isValid) {
      throw new BadRequestException('Invalid week date. Use format YYYY-MM-DD.')
    }

    const weekStart = anchor.startOf('week')
    const weekEnd = weekStart.plus({ days: 7 })

    const where = {
      slotTime: {
        gte: weekStart.toUTC().toJSDate(),
        lt: weekEnd.toUTC().toJSDate(),
      },
    }

    const safePage = Math.max(1, page)
    const safeLimit = Math.min(100, Math.max(1, limit))

    const [total, bookings] = await Promise.all([
      prisma.demoBooking.count({ where }),
      prisma.demoBooking.findMany({
        where,
        orderBy: { slotTime: 'asc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
    ])

    return {
      data: bookings,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
        weekStart: weekStart.toISODate(),
        weekEnd: weekStart.plus({ days: 4 }).toISODate(),
      },
    }
  }

  async findOne(id: string) {
    const booking = await prisma.demoBooking.findUnique({ where: { id } })
    if (!booking) throw new NotFoundException(`Demo booking ${id} not found`)
    return booking
  }

  async updateStatus(id: string, dto: UpdateBookDemoStatusDto) {
    const booking = await prisma.demoBooking.findUnique({ where: { id } })
    if (!booking) throw new NotFoundException(`Demo booking ${id} not found`)

    // Rejecting frees the slot for someone else to book — the unique
    // constraint on slotTime means a CANCELLED row left in place would
    // otherwise block that time forever, so the row is removed instead.
    if (dto.status === DemoBookingStatus.CANCELLED) {
      await prisma.demoBooking.delete({ where: { id } })
      return { message: 'Demo booking rejected and slot reopened', id }
    }

    return prisma.demoBooking.update({
      where: { id },
      data: { status: dto.status },
    })
  }

  async accept(id: string) {
    return this.updateStatus(id, { status: DemoBookingStatus.CONFIRMED })
  }

  async reject(id: string) {
    return this.updateStatus(id, { status: DemoBookingStatus.CANCELLED })
  }

  async remove(id: string) {
    const booking = await prisma.demoBooking.findUnique({ where: { id } })
    if (!booking) throw new NotFoundException(`Demo booking ${id} not found`)

    await prisma.demoBooking.delete({ where: { id } })
    return { message: 'Demo booking deleted successfully' }
  }

  // Keeps recent bookings for follow-up, then clears out anything whose slot
  // is more than two weeks in the past.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldBookings() {
    const cutoff = DateTime.now().minus({ weeks: 2 }).toJSDate()
    const result = await prisma.demoBooking.deleteMany({
      where: { slotTime: { lt: cutoff } },
    })
    if (result.count > 0) {
      console.log(`[BookDemo] Auto-deleted ${result.count} booking(s) older than 2 weeks`)
    }
  }
}
