// src/lib/ai.ts
import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI() {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  client = new OpenAI({ apiKey: key });
  return client;
}

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

