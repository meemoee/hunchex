import { redis } from '@/app/db/redis'
import { TopMover } from '@/types/mover'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface TopMoversManifest {
  chunks: number
  marketsPerChunk: number
  totalMarkets: number
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const searchParams = url.searchParams
    const interval = searchParams.get('interval') || '240'
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const openOnly = searchParams.get('openOnly') === 'true'

    // Get latest timestamp
    const timestamp = await redis.get(`topMovers:${interval}:latest`)
    if (!timestamp) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Try to get manifest
    const manifestData = await redis.get(`topMovers:${interval}:${timestamp}:manifest`)
    
    // If no manifest, fall back to old format
    if (!manifestData) {
      const oldFormatData = await redis.get(`topMovers:${interval}:${timestamp}`)
      if (!oldFormatData) {
        return new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' }
        })
      }
      
      let allMovers = JSON.parse(oldFormatData) as TopMover[]
      if (openOnly) {
        allMovers = allMovers.filter(m => 
          m.market_id.includes('-') || 
          (m.active && !m.closed && !m.archived)
        )
      }
      const start = (page - 1) * pageSize
      const paginatedMovers = allMovers.slice(start, start + pageSize)
      return new Response(JSON.stringify(paginatedMovers), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Parse manifest
    const manifest = JSON.parse(manifestData) as TopMoversManifest
    
    // Calculate which chunks we need based on pagination
    const startChunk = Math.floor((page - 1) * pageSize / manifest.marketsPerChunk)
    const endChunk = Math.floor((page * pageSize - 1) / manifest.marketsPerChunk)
    
    // Fetch required chunks
    const chunkPromises = []
    for (let i = startChunk; i <= endChunk; i++) {
      if (i < manifest.chunks) {
        chunkPromises.push(
          redis.get(`topMovers:${interval}:${timestamp}:chunk:${i}`)
        )
      }
    }
    
    const chunks = await Promise.all(chunkPromises)
    

    // Combine chunks and handle missing data
	let allMovers: TopMover[] = []
	chunks.forEach((chunk) => {
	  if (chunk) {
		const chunkData = JSON.parse(chunk) as TopMover[]
		allMovers = allMovers.concat(chunkData)
	  }
	})

    // Apply openOnly filter if needed
    if (openOnly) {
      allMovers = allMovers.filter(m => 
        m.market_id.includes('-') || 
        (m.active && !m.closed && !m.archived)
      )
    }

    // Calculate correct slice for pagination
    const startIndex = (page - 1) * pageSize % manifest.marketsPerChunk
    const paginatedMovers = allMovers.slice(startIndex, startIndex + pageSize)

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