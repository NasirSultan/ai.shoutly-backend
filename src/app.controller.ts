import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaClient } from '@prisma/client'; // Import the base client

@Controller()
export class AppController {
  // Manual instantiation to match your other services
  private prisma = new PrismaClient(); 

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