import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class MetaService {
  private readonly appSecret = process.env.FB_APP_SECRET || process.env.META_APP_SECRET;
  private readonly statusBaseUrl =
    process.env.FRONTEND_URL?.replace(/\/$/, '') || 'https://shoutlyai.com';

  parseSignedRequest(signedRequest: string): { user_id: string } {
    if (!this.appSecret) {
      throw new BadRequestException('Meta app secret is not configured');
    }

    const parts = signedRequest.split('.');
    if (parts.length !== 2) {
      throw new BadRequestException('Invalid signed_request format');
    }

    const [encodedSig, payload] = parts;
    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const expectedSig = crypto
      .createHmac('sha256', this.appSecret)
      .update(payload)
      .digest();

    if (!crypto.timingSafeEqual(sig, expectedSig)) {
      throw new BadRequestException('Invalid signed_request signature');
    }

    const data = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { user_id?: string };

    if (!data.user_id) {
      throw new BadRequestException('signed_request missing user_id');
    }

    return { user_id: data.user_id };
  }

  async handleDataDeletion(facebookUserId: string) {
    const confirmationCode = crypto.randomBytes(8).toString('hex');

    // We do not persist Meta app-scoped user IDs locally today. Log the request
    // and return Meta's required status URL + confirmation code. Ops can match
    // the request to a Shoutly user via support email if needed.
    console.info(
      `[Meta data deletion] facebook_user_id=${facebookUserId} confirmation=${confirmationCode}`,
    );

    return {
      url: `${this.statusBaseUrl}/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }
}
