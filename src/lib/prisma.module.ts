import { Module, Global } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { prisma } from './prisma'

// Previously this module instantiated its own `new PrismaClient()` via
// PrismaService, on top of the separate singleton already exported by
// lib/prisma.ts (used directly by most services). That meant two
// independent connection pools opened simultaneously on every cold boot,
// which is what was causing the repeated P1001 "can't reach database
// server" failures against Supabase's pooled connection — a burst of two
// pools' worth of connections at once exceeded what the transaction
// pooler would grant. Reusing the same singleton here means there's only
// ever one pool, opened lazily on first query instead of eagerly at boot.
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: prisma as unknown as PrismaService }],
  exports: [PrismaService],
})
export class PrismaModule {}
