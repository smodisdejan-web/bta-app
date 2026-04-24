// src/lib/ai.ts
import Anthropic from "@anthropic-ai/sdk";

let anthropicClient: Anthropic | null = null;

export function getAnthropic() {
  if (anthropicClient) return anthropicClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is missing");
  anthropicClient = new Anthropic({ apiKey: key });
  return anthropicClient;
}

export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
