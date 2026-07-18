import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { AiUsageLogService } from '../../../ai-usage/ai-usage-log.service';

export interface AiUsageContext {
  userId?: string | null;
}

@Injectable()
export class GeminiService {
  private readonly ai: GoogleGenAI;

  constructor(private readonly aiUsageLogService: AiUsageLogService) {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }



async generateText(prompt: string, context?: AiUsageContext, retries = 3, delayMs = 2000): Promise<string> {
  const model = 'gemini-2.5-flash';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await this.ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      })

      this.aiUsageLogService.logText({
        userId: context?.userId,
        provider: 'GEMINI',
        model,
        operation: 'TEXT_GENERATION',
        promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
      });

      return result.text ?? ''
    } catch (error: any) {
      const message = this.extractErrorMessage(error)
      const isOverloaded =
        message.includes('high demand') ||
        message.includes('overloaded') ||
        message.includes('503') ||
        message.includes('429')

      if (isOverloaded && attempt < retries) {
        console.warn(`[GeminiService] Attempt ${attempt} failed, retrying in ${delayMs}ms...`)
        await new Promise((res) => setTimeout(res, delayMs * attempt))
        continue
      }

      console.error('[GeminiService] generateText failed:', message)
      throw new InternalServerErrorException(`Gemini Error: ${message}`)
    }
  }
  throw new InternalServerErrorException('Gemini Error: Max retries exceeded')
}

async generateImages(prompt: string, context?: AiUsageContext): Promise<string[]> {
  const model = 'gemini-2.5-flash-image';
  try {
    const result = await this.ai.models.generateContent({
model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    const images: string[] = [];

    for (const part of result.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        images.push(part.inlineData.data);
      }
    }

    if (images.length > 0) {
      this.aiUsageLogService.logImage({
        userId: context?.userId,
        model,
        imageCount: images.length,
      });
    }

    return images;
  } catch (error: any) {
    const message = this.extractErrorMessage(error);
    console.error('[GeminiService] generateImages failed:', message);
    throw new InternalServerErrorException(`Image Error: ${message}`);
  }
}

  private extractErrorMessage(error: any): string {
    try {
      const body =
        typeof error?.errorDetails === 'string'
          ? JSON.parse(error.errorDetails)
          : error?.errorDetails ?? JSON.parse(error?.message ?? '{}');

      if (body?.error?.message) return body.error.message;
    } catch {}

    return error?.message ?? 'Unknown error';
  }
}