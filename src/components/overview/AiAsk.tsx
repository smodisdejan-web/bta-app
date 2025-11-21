// src/components/overview/AiAsk.tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Copy, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { AIAskResponse } from '@/lib/overview-types'

interface AiAskProps {
  onAsk: (prompt: string) => Promise<AIAskResponse>
}

export function AiAsk({ onAsk }: AiAskProps) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<string[]>([])
  const { toast } = useToast()
  
  const handleSubmit = async () => {
    if (!prompt.trim()) return
    
    setLoading(true)
    try {
      const result = await onAsk(prompt)
      setResponse(result.bullets)
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
    const text = response.join('\n')
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
        
        {response.length > 0 && (
          <div className="space-y-2">
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
            <ul className="space-y-2 bg-muted p-4 rounded-lg">
              {response.map((bullet, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-primary mt-1">•</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

