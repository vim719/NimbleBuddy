import type { Metadata } from 'next'

import MarketPulse from '@/components/MarketPulse'

export const metadata: Metadata = {
  title: 'Market Pulse | NimbleBuddy',
  description: 'Cited stock and crypto sentiment outlooks from the live web, powered by Nimbleway.',
}

export default function MarketPage() {
  return <MarketPulse />
}
