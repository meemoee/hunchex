import { redis } from '@/app/db/redis'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MarketMover {
  market_id: string
  active: boolean
  closed: boolean
  archived: boolean
  // Add any other properties that might be in the data
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const searchParams = url.searchParams
    const interval = searchParams.get('interval') || '240'
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const openOnly = searchParams.get('openOnly') === 'true'

    // Get latest timestamp for this interval
    const timestamp = await redis.get(`topMovers:${interval}:latest`)
    if (!timestamp) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get full data set
    const data = await redis.get(`topMovers:${interval}:${timestamp}`)
    if (!data) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Parse and filter data
    let allMovers = JSON.parse(data) as MarketMover[]
    
    // Apply openOnly filter if needed
    if (openOnly) {
      allMovers = allMovers.filter((m: MarketMover) => 
        m.market_id.includes('-') || 
        (m.active && !m.closed && !m.archived)
      )
    }

    // Handle pagination
    const start = (page - 1) * pageSize
    const paginatedMovers = allMovers.slice(start, start + pageSize)

    return new Response(JSON.stringify(paginatedMovers), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error in top_movers route:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}