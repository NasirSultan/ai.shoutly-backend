import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { prisma } from './lib/prisma';

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

  @Get('seed-industries')
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