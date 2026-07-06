import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { CreatePostDto ,DirectPostDto} from './dto/post.dto';
import { DateTime } from 'luxon'
import { BrevoService } from 'src/brevo/brevo.service'
import { prisma } from '../../lib/prisma';


@Injectable()
export class FacebookService {
  private readonly appId = process.env.FB_APP_ID;
  private readonly appSecret = process.env.FB_APP_SECRET;
  private readonly redirectUri = process.env.FB_REDIRECT_URI;
  private readonly brevoService: BrevoService;

  constructor(brevoService: BrevoService) {
    this.brevoService = brevoService;
  }

  getOAuthUrl(state: string): string {
    return (
      `https://www.facebook.com/v19.0/dialog/oauth` +
      `?client_id=${this.appId}` +
      `&redirect_uri=${this.redirectUri}` +
      `&scope=public_profile,pages_show_list,pages_read_engagement,pages_manage_posts` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  async exchangeCodeForToken(code: string, userId: string) {
    const { data: short } = await axios.get(
      'https://graph.facebook.com/v19.0/oauth/access_token',
      {
        params: {
          client_id:     this.appId,
          client_secret: this.appSecret,
          redirect_uri:  this.redirectUri,
          code,
        },
      },
    );

    const { data: long } = await axios.get(
      'https://graph.facebook.com/v19.0/oauth/access_token',
      {
        params: {
          grant_type:        'fb_exchange_token',
          client_id:         this.appId,
          client_secret:     this.appSecret,
          fb_exchange_token: short.access_token,
        },
      },
    );

    const { data: pagesData } = await axios.get(
      'https://graph.facebook.com/v19.0/me/accounts',
      { params: { access_token: long.access_token } },
    );

    const pages = pagesData.data as {
      id: string;
      name: string;
      access_token: string;
    }[];


    const account = await prisma.facebookAccount.upsert({
      where:  { userId },
      update: { accessToken: long.access_token },
      create: { userId, accessToken: long.access_token },
    });


    await prisma.facebookPage.deleteMany({
      where: { facebookAccountId: account.id },
    });

    await prisma.facebookPage.createMany({
      data: pages.map((page) => ({
        facebookAccountId: account.id,
        pageId:            page.id,
        pageName:          page.name,
        pageAccessToken:   page.access_token,
        isDefault:         false,
      })),
    });

    return {
      message: 'Connected — call GET /facebook/pages then POST /facebook/select-page',
      pages: pages.map((p) => ({ pageId: p.id, pageName: p.name })),
    };
  }


  async getPages(userId: string) {
    const account = await prisma.facebookAccount.findUnique({
      where:   { userId },
      include: { pages: true },
    });

    if (!account) throw new Error('Account not connected');

    return account.pages.map((p) => ({
      pageId:    p.pageId,
      pageName:  p.pageName,
      isDefault: p.isDefault,
    }));
  }


  async selectPage(userId: string, pageId: string) {
    const account = await prisma.facebookAccount.findUnique({
      where:   { userId },
      include: { pages: true },
    });

    if (!account) throw new Error('Account not connected');

    const exists = account.pages.some((p) => p.pageId === pageId);
    if (!exists)  throw new Error(`pageId ${pageId} not found for this account`);


    await prisma.facebookPage.updateMany({
      where: { facebookAccountId: account.id },
      data:  { isDefault: false },
    });


    await prisma.facebookPage.updateMany({
      where: { facebookAccountId: account.id, pageId },
      data:  { isDefault: true },
    });

    return { success: true, selectedPageId: pageId };
  }


async postToPage(dto: CreatePostDto) {
  const page = await prisma.facebookPage.findFirst({
    where: { pageId: dto.pageId },
  });

  if (!page) throw new Error('Page not found');

  const token = page.pageAccessToken;

  const parts = [
    dto.title,
    dto.message,
    dto.hashtags?.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
  ].filter(Boolean);

  const fullMessage = parts.join('\n\n');

  if (dto.imageUrl) {
    const { data } = await axios.post(
      `https://graph.facebook.com/v19.0/${page.pageId}/photos`,
      { url: dto.imageUrl, caption: fullMessage, access_token: token },
    );
    return data;
  }

  const { data } = await axios.post(
    `https://graph.facebook.com/v19.0/${page.pageId}/feed`,
    { message: fullMessage, access_token: token },
  );
  return data;
}

async getMyTokens(userId: string) {
  const account = await prisma.facebookAccount.findUnique({
    where: { userId },
    include: { pages: true },
  });

  if (!account) throw new Error('Account not connected');

  return {
    userAccessToken: account.accessToken,
    pages: account.pages.map((p) => ({
      pageId: p.pageId,
      pageName: p.pageName,
      pageAccessToken: p.pageAccessToken,
      isDefault: p.isDefault,
    })),
  };
}

async directPost(dto: DirectPostDto) {
  const account = await prisma.facebookAccount.findUnique({
    where: { userId: dto.userId },
    include: { pages: true },
  })

  if (!account) throw new Error('Facebook account not connected')

  const defaultPage = account.pages.find((p) => p.isDefault) || account.pages[0]
  if (!defaultPage) throw new Error('No Facebook page found')

  const result = await this.postToPage({
    pageId: defaultPage.pageId,
    title: dto.title,
    message: dto.message,
    imageUrl: dto.imageUrl,
    hashtags: dto.hashtags,
  })

  // Send notification email
  const user = await prisma.user.findUnique({
    where: { id: dto.userId },
    select: { email: true, name: true, timezone: true },
  })

  if (user?.email) {
    const tz = user.timezone || 'Asia/Karachi'
    const postedAt = DateTime.now().setZone(tz).toFormat('MMM dd, yyyy \'at\' hh:mm a')

    await this.brevoService.sendPostPublishedEmail(
      user.email,
      user.name,
      defaultPage.pageName || defaultPage.pageId,
      postedAt,
    ).catch((err) => console.error('[Brevo] Email failed:', err.message))
  }

  return result
}


}