// src/components/overview/AiAsk.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Copy, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { AIAskResponse } from '@/lib/overview-types'

interface AiAskProps {
  onAsk: (prompt: string) => Promise<AIAskResponse>
  prefill?: string
}

function normalizeBullets(raw: any): string[] {
  let bullets: string[] = []

  try {
    let data: any = raw
    if (typeof data === 'string') {
      data = JSON.parse(data)
    }
    if (data && Array.isArray(data.bullets)) {
      bullets = data.bullets
    } else if (Array.isArray(data)) {
      bullets = data
    }
  } catch (e) {
    console.error('Failed to parse AI response:', e)
    bullets = []
  }

  return bullets
    .map((b) => b.replace(/\*\*/g, '').trim())
    .filter(Boolean)
}

function renderBullet(text: string, key: number) {
  const html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  return (
    <p
      key={key}
      className="text-sm leading-relaxed text-[#1a1a1a]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function AiAsk({ onAsk, prefill }: AiAskProps) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [bullets, setBullets] = useState<string[]>([])
  const { toast } = useToast()
  
  useEffect(() => {
    if (prefill) {
      setPrompt(prefill)
    }
  }, [prefill])
  
  const handleSubmit = async () => {
    if (!prompt.trim()) return
    
    setLoading(true)
    try {
      const result = await onAsk(prompt)
      let bullets = normalizeBullets(result)
      setBullets(bullets)
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate insights. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }
  
  const handleCopy = () => {
    const text = bullets.join('\n')
    navigator.clipboard.writeText(text)
    toast({
      title: 'Copied',
      description: 'Insights copied to clipboard'
    })
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Insights Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="Ask a question about your marketing performance..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        <Button
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
          className="w-full"
        >
          {loading ? 'Generating...' : 'Generate AI Insights'}
        </Button>
        
        {bullets.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Insights:</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
            <div className="space-y-3 bg-muted p-4 rounded-lg">
              {bullets.map((bullet, idx) => (
                <p key={idx} className="text-sm leading-relaxed text-[#1a1a1a] whitespace-pre-wrap mb-2">
                  {bullet}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}



