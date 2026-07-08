import { Injectable } from '@nestjs/common'
import { prisma } from '../lib/prisma'

@Injectable()
export class NotesService {
  async get(userId: string) {
    const note = await prisma.note.findUnique({ where: { userId } })
    return { text: note?.text || '', updatedAt: note?.updatedAt || null }
  }

  async upsert(userId: string, text: string) {
    const note = await prisma.note.upsert({
      where: { userId },
      update: { text },
      create: { userId, text }
    })
    return { text: note.text, updatedAt: note.updatedAt }
  }
}
