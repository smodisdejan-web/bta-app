'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { LLMProvider, LLMResponse } from '@/lib/types'
import { 
  Loader2, 
  Sparkles, 
  Copy, 
  Check
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export type InsightsGeneratorProps = {
  className?: string
  defaultPrompt?: string
  defaultModel?: LLMProvider
  contextHint?: string
}

export function InsightsGenerator({
  className = '',
  defaultPrompt = '',
  defaultModel = 'gemini-pro',
  contextHint = 'Generate qualitative insights using large language models • Cmd+K to focus'
}: InsightsGeneratorProps) {
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [selectedModel, setSelectedModel] = useState<LLMProvider>(defaultModel)
  const [aiInsights, setAiInsights] = useState<LLMResponse | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  // Update prompt when defaultPrompt changes
  useEffect(() => {
    setPrompt(defaultPrompt)
  }, [defaultPrompt])

  // Listen for custom event to set prompt from outside
  useEffect(() => {
    const handleSetPrompt = (e: CustomEvent<string>) => {
      setPrompt(e.detail)
      // Focus the textarea
      setTimeout(() => {
        document.getElementById('ai-prompt')?.focus()
      }, 100)
    }
    window.addEventListener('set-ai-prompt' as any, handleSetPrompt as EventListener)
    return () => {
      window.removeEventListener('set-ai-prompt' as any, handleSetPrompt as EventListener)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch(e.key) {
          case 'k':
            e.preventDefault()
            document.getElementById('ai-prompt')?.focus()
            break
          case 'Enter':
            if (document.activeElement?.id === 'ai-prompt') {
              e.preventDefault()
              handleGenerate()
            }
            break
        }
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [prompt, selectedModel])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    try {
      // Map UI model selection to OpenAI model name
      const modelMap: Record<string, string> = {
        'gemini-pro': 'gpt-4o-mini',
        'gpt-4': 'gpt-4o-mini',
        'claude-3-sonnet': 'gpt-4o-mini'
      }
      const model = modelMap[selectedModel] || 'gpt-4o-mini'

      const payload = {
        prompt,
        model
      }

      console.log('[insights] click', { model, promptLength: prompt.length })

      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      console.log('[insights] response', { ok: response.ok, status: response.status, hasError: !!data.error })

      if (!response.ok || data.error) {
        setAiInsights({
          text: '',
          error: data.error || 'Failed to generate insights'
        })
        return
      }

      setAiInsights({
        text: data.text || data.answer || '',
        tokenUsage: data.tokenUsage
      })
    } catch (error) {
      console.error('Error generating insights:', error)
      setAiInsights({
        text: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, selectedModel])

  const copyInsight = () => {
    if (aiInsights?.text) {
      navigator.clipboard.writeText(aiInsights.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({ title: "✅ Copied to clipboard" })
    }
  }

  return (
    <div className={className}>
      <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-7 w-7 text-primary animate-pulse" />
            AI Insights Generator
          </CardTitle>
          {contextHint && (
            <CardDescription className="text-base">
              {contextHint}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Model Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model" className="text-base font-semibold">AI Model</Label>
              <Select
                value={selectedModel}
                onValueChange={(value) => setSelectedModel(value as LLMProvider)}
              >
                <SelectTrigger id="model" className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-pro">
                    <div className="flex items-center gap-2">
                      <span>🔷</span>
                      <div>
                        <div className="font-medium">Google Gemini Pro</div>
                        <div className="text-xs text-muted-foreground">Fast & Free tier available</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="gpt-4">
                    <div className="flex items-center gap-2">
                      <span>🟢</span>
                      <div>
                        <div className="font-medium">OpenAI GPT-4</div>
                        <div className="text-xs text-muted-foreground">Most capable</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="claude-3-sonnet">
                    <div className="flex items-center gap-2">
                      <span>🟣</span>
                      <div>
                        <div className="font-medium">Anthropic Claude 3 Sonnet</div>
                        <div className="text-xs text-muted-foreground">Balanced performance</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <Label htmlFor="ai-prompt" className="text-base font-semibold">Your Question or Prompt</Label>
            <textarea
              id="ai-prompt"
              className="w-full min-h-[120px] p-4 rounded-md border-2 border-input bg-background focus:border-primary transition-colors text-base"
              placeholder="E.g., What are the top performing search terms? What patterns do you see in the data? What recommendations would you make?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              💡 Tip: Be specific about what you want to know. Cmd+Enter to generate
            </p>
          </div>

          {/* Generate Button */}
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              handleGenerate()
            }}
            disabled={!prompt.trim() || isGenerating}
            className="w-full h-14 text-lg font-semibold"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Generating Insights...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 mr-2" />
                Generate AI Insights
              </>
            )}
          </Button>

          {/* AI Response */}
          {aiInsights && (
            <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {aiInsights.error ? (
                <div className="p-6 bg-destructive/10 border-2 border-destructive rounded-lg text-destructive">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div className="flex-1">
                      <p className="font-semibold text-lg mb-2">Error Generating Insights</p>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{aiInsights.error}</pre>
                      <div className="mt-4 p-3 bg-background/50 rounded text-xs">
                        <p className="font-semibold mb-1">💡 Quick Tip:</p>
                        <p>Switch to <strong>Gemini Pro</strong> in the dropdown above - it has a free tier and works great for testing!</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      Generated Insights
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyInsight}
                      className="gap-2"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="p-6 bg-gradient-to-br from-muted/50 to-background rounded-lg border-2 prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap leading-relaxed">{aiInsights.text}</div>
                  </div>
                  {aiInsights.tokenUsage && (
                    <div className="flex gap-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                      <span>📊 Token usage:</span>
                      <span><strong>{aiInsights.tokenUsage.inputTokens.toLocaleString()}</strong> input</span>
                      <span><strong>{aiInsights.tokenUsage.outputTokens.toLocaleString()}</strong> output</span>
                      <span><strong>{aiInsights.tokenUsage.totalTokens.toLocaleString()}</strong> total</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts Help */}
      <Card className="border bg-muted/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground items-center justify-center">
            <span className="font-semibold">⌨️ Keyboard Shortcuts:</span>
            <Badge variant="outline">Cmd+K: Focus prompt</Badge>
            <Badge variant="outline">Cmd+Enter: Generate</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

