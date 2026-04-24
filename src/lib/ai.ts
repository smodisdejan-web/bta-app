// src/lib/ai.ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;

export function getOpenAI() {
  if (openaiClient) return openaiClient;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  openaiClient = new OpenAI({ apiKey: key });
  return openaiClient;
}

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

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
