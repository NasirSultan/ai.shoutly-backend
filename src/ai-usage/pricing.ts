// Approximate provider pricing, USD. NOT pulled from a live pricing API — these are
// manually entered placeholder rates and WILL drift as providers change pricing.
// Update this file whenever you verify current rates against each provider's pricing page.
export const PRICING = {
  GEMINI: {
    'gemini-2.5-flash': {
      inputPerMillion: 0.30,
      outputPerMillion: 2.50,
    },
    'gemini-2.5-flash-image': {
      // Billed per generated image rather than per token.
      perImage: 0.039,
    },
  },
  DEEPSEEK: {
    'deepseek-chat': {
      inputPerMillion: 0.27,
      outputPerMillion: 1.10,
    },
  },
  OPENAI: {
    'text-embedding-3-small': {
      inputPerMillion: 0.02,
      outputPerMillion: 0,
    },
  },
} as const;

export function estimateTextCostUsd(
  provider: 'GEMINI' | 'DEEPSEEK' | 'OPENAI',
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const table: any = (PRICING as any)[provider]?.[model];
  if (!table || table.inputPerMillion === undefined) return 0;
  const inputCost = (promptTokens / 1_000_000) * table.inputPerMillion;
  const outputCost = (completionTokens / 1_000_000) * (table.outputPerMillion ?? 0);
  return Number((inputCost + outputCost).toFixed(6));
}

export function estimateImageCostUsd(model: string, imageCount: number): number {
  const table: any = (PRICING as any).GEMINI?.[model];
  if (!table || table.perImage === undefined) return 0;
  return Number((table.perImage * imageCount).toFixed(6));
}
