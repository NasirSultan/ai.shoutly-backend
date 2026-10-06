import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { prisma } from './lib/prisma';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Controller()
export class AppController {
  private prisma = prisma;

  constructor(
    private readonly appService: AppService,
    // REMOVED PrismaService from here
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Writes to the database, so it's admin-only and a POST (it used to be a
  // public GET that anyone could call).
  @Post('seed-industries')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  async seedIndustries() {
    const industries = [
      { name: 'Fashion' }, 
      { name: 'Food' }, 
      { name: 'Fitness' }, 
      { name: 'Technology' }
    ];
    const created: any[] = [];

    for (const industry of industries) {
      const exists = await this.prisma.industry.findFirst({
        where: { name: industry.name },
      });

      if (!exists) {
        const newIndustry = await this.prisma.industry.create({
          data: industry,
        });
        created.push(newIndustry);
      }
    }

    return { 
      message: 'Seeding complete', 
      createdCount: created.length, 
      data: created 
    };
  }
}