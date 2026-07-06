import { Injectable } from '@nestjs/common';
import { Content } from '@prisma/client';
import { CreateContentDto } from './dto/create-content.dto';
import { prisma } from '../../../lib/prisma';

@Injectable()
export class ContentService {
  private prisma = prisma;

async createMultipleContents(subIndustryId: string, posts: CreateContentDto[]): Promise<Content[]> {
  return this.prisma.$transaction(
    async (tx) => {
      const createdContents: Content[] = [];

      for (const post of posts) {
        const { text, hashtags } = post;

        const content = await tx.content.create({
          data: { text, subIndustryId },
        });

        if (hashtags.length) {
          await tx.hashtag.createMany({
            data: hashtags.map((tag) => ({ tag })),
            skipDuplicates: true,
          });

          const existingHashtags = await tx.hashtag.findMany({
            where: { tag: { in: hashtags } },
            select: { id: true },
          });

          await tx.contentHashtag.createMany({
            data: existingHashtags.map((h) => ({
              contentId: content.id,
              hashtagId: h.id,
            })),
            skipDuplicates: true,
          });
        }

        createdContents.push(content);
      }

      return createdContents;
    },
    { maxWait: 60000, timeout: 180000 },
  );
}


async getContentsBySubIndustry(subIndustryId: string) {
  const [subIndustry, contents] = await Promise.all([
    this.prisma.subIndustry.findUnique({
      where: { id: subIndustryId },
      select: { id: true, name: true },
    }),
    this.prisma.content.findMany({
      where: { subIndustryId },
      orderBy: { createdAt: 'desc' },
      select: {
        text: true,
        hashtags: {
          select: {
            hashtag: {
              select: { tag: true },
            },
          },
        },
      },
    }),
  ]);

  if (!subIndustry) return null;

  const formattedContents = contents.map(c => ({
    text: c.text,
    hashtags: c.hashtags.map(h => h.hashtag.tag),
  }));

  return {
    subIndustry,
    total: contents.length,
    contents: formattedContents,
  };
}

 async deleteContentsBySubIndustry(subIndustryId: string) {
    return this.prisma.$transaction(async (tx) => {
      const contents = await tx.content.findMany({
        where: { subIndustryId },
        select: { id: true },
      });

      const contentIds = contents.map(c => c.id);

      if (contentIds.length) {
        await tx.contentHashtag.deleteMany({
          where: { contentId: { in: contentIds } },
        });

        await tx.content.deleteMany({
          where: { id: { in: contentIds } },
        });
      }

      return { deletedCount: contentIds.length };
    });
  }


}
