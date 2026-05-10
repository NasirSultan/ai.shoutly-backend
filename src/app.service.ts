import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'ShoutlyAI backend is running ya ya';
  }
}
