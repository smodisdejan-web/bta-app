import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 pt-16 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-lg border border-gray-200 p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">404 - Page Not Found</h2>
        <p className="text-gray-600 mb-6">
          The page you're looking for doesn't exist.
        </p>
        <Link href="/">
          <Button>Go home</Button>
        </Link>
      </div>
    </div>
  )
}

