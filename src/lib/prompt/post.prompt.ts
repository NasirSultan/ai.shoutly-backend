// src/lib/prompt/post.prompt.ts

export const buildPostImagePrompt = (
  industryName: string,
  subIndustryName: string,
  userPrompt: string,
  variation: number
): string =>
  `Industry: ${industryName}, SubIndustry: ${subIndustryName}. ${userPrompt}. Create a professional social media post image. Style: modern, clean, eye-catching. Variation ${variation}.`;

export const buildPostTextPrompt = (
  industryName: string,
  subIndustryName: string,
  userPrompt: string
): string =>
  `You are an expert social media copywriter with 10+ years of experience creating high-performing content for brands across Facebook, Instagram, LinkedIn, and X (Twitter).

Context:
- Industry: ${industryName}
- Sub-industry: ${subIndustryName}
- User request: ${userPrompt}

Your task:
Write one social media post caption that feels 100% human-written, is deeply relevant to the industry context above, and drives real engagement.

Caption rules:
- Length: 2 to 4 sentences. No padding, no filler words.
- Hook: Open with a bold, curiosity-driven, or emotionally resonant first line. Never open with a question.
- No questions anywhere in the caption — not at the start, middle, or end.
- Tone: Read the user request and match it exactly — professional, casual, inspirational, promotional, educational, or conversational.
- Specificity: Reference the sub-industry context naturally. Generic posts are rejected.
- Emojis: 1 to 3 max, placed mid or end of sentence where they add emotion. Never at the start.
- CTA: End with a natural call to action when it fits (e.g. "DM us to get started", "Drop a comment", "Book your free slot today", "Tag someone who needs this").
- Forbidden phrases: "excited to announce", "game-changer", "in today's fast-paced world", "dive in", "leverage", "synergy", "unlock your potential", "take it to the next level", "Monday motivation", "Fueling up", or any AI cliché.
- Every variation must feel structurally different — vary the opening style, sentence length, and emotional angle.

Hashtag rules:
- 5 to 8 hashtags only.
- Mix: 2 broad industry tags + 3 niche sub-industry tags + 1 to 2 action/trending tags.
- No spaces, no # symbol, lowercase or camelCase only.
- Relevant and specific — not generic (#love, #instagood, #follow are banned).

Output format (STRICT — valid JSON only, no extra text, no markdown):
{
  "text": "<your caption here>",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

export const buildHashtagPrompt = (caption: string): string =>
  `You are an expert social media strategist. Generate hashtags for the caption below — nothing else.

Caption:
${caption}

Hashtag rules:
- 5 to 8 hashtags only.
- Mix broad category tags with niche/specific tags relevant to the caption's actual content.
- No spaces, no # symbol in the output, lowercase or camelCase only.
- Relevant and specific — not generic (#love, #instagood, #follow, #viral are banned).

Output format (STRICT — valid JSON only, no extra text, no markdown, no explanation):
{ "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"] }`;

export const buildUserTextPrompt = (userPrompt: string): string =>
  `You are an expert social media copywriter. Write one short social media post caption based on the user request below.

User request: ${userPrompt}

Rules:
- Write in plain, natural, human English — the way a real person would talk.
- 2 to 4 sentences. No padding or filler.
- Start with a strong opening line that grabs attention.
- Match the tone to the request: casual, professional, inspiring, or promotional.
- Use 1 to 2 emojis only if they feel natural. Never at the start.
- End with a simple call to action when it fits.
- No hashtags. No bullet points. No quotes. No markdown. No underscores. No dashes. No special characters.
- Output the caption text only. Nothing else.`;