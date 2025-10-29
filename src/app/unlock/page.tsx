'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function UnlockPage() {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get('redirect') || '/'

  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Invalid password')
      }
      router.push(redirect)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-card border rounded-2xl shadow-sm p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Enter Access Password</h1>
            <p className="text-muted-foreground mt-1">Protected Goolets AI Agent</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Password</label>
              <Input
                type="password"
                autoFocus
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading || password.length === 0}>
              {loading ? 'Unlocking…' : 'Unlock'}
            </Button>
          </form>

          <div className="text-xs text-muted-foreground text-center mt-6">
            Access is restricted. Contact admin if you need help.
          </div>
        </div>
      </div>
    </div>
  )
}


