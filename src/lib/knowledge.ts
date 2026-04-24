// src/lib/knowledge.ts
// Loads Goolets business knowledge from markdown files and caches in memory.
// Sync source: ppcos/goolets/context/ (brain). Update by copying files here.

import fs from 'fs'
import path from 'path'

let cachedKnowledge: string | null = null

const KNOWLEDGE_FILES = [
  'business-context.md',
  'kpis-2026.md',
  'handoff.md',
] as const

export function getGooletsKnowledge(): string {
  if (cachedKnowledge !== null) return cachedKnowledge

  const knowledgeDir = path.join(process.cwd(), 'src', 'lib', 'knowledge')

  const parts: string[] = []
  for (const filename of KNOWLEDGE_FILES) {
    try {
      const filePath = path.join(knowledgeDir, filename)
      const content = fs.readFileSync(filePath, 'utf-8')
      parts.push(`## ${filename}\n\n${content.trim()}`)
    } catch (err) {
      console.warn(`[knowledge] failed to load ${filename}:`, err)
    }
  }

  cachedKnowledge = parts.join('\n\n---\n\n')
  return cachedKnowledge
}
