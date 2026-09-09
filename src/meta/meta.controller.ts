import { Body, Controller, Post } from '@nestjs/common';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  /**
   * Meta App Review data-deletion callback.
   * Configure in Meta Developer Console → App settings → Advanced → Data Deletion Request URL.
   */
  @Post('data-deletion')
  async dataDeletion(@Body() body: { signed_request?: string }) {
    const signedRequest = body?.signed_request;
    if (!signedRequest) {
      return { error: 'signed_request is required' };
    }

    const { user_id } = this.metaService.parseSignedRequest(signedRequest);
    return this.metaService.handleDataDeletion(user_id);
  }
}
