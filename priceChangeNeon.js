require("dotenv").config();
const { neon } = require("@neondatabase/serverless");
const Redis = require("ioredis");
const { performance } = require("perf_hooks");

// Constants
const TEST_INTERVALS = [5, 10, 30, 60, 240, 480, 1440, 10080];
const CHUNK_SIZE = 500;
const QUERY_TIMEOUT = 60000;

// Initialize Neon PostgreSQL
const sql = neon(process.env.DATABASE_URL);

// Initialize Redis
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : new Redis({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: 3,
      commandTimeout: 60000,
      connectTimeout: 60000,
      retryStrategy: (times) => Math.min(times * 100, 3000)
    });

async function getActiveMarkets(timeRange) {
  const { pastDate, now } = timeRange;
  console.log('Getting active market IDs...');
  const startTime = performance.now();

  try {
    const markets = await sql`
      WITH active_markets AS (
        SELECT DISTINCT m.id as market_id
        FROM markets m
        WHERE m.id LIKE '%-%' OR (m.active = true AND m.closed = false AND m.archived = false)
      ),
      markets_with_prices AS (
        SELECT DISTINCT market_id
        FROM market_prices
        WHERE timestamp BETWEEN ${pastDate} AND ${now}
      )
      SELECT am.market_id
      FROM active_markets am
      INNER JOIN markets_with_prices mp ON am.market_id = mp.market_id
    `;

    console.log(`Found ${markets.length} active markets in ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
    return markets.map(row => row.market_id);
  } catch (error) {
    console.error('Error getting active markets:', error);
    throw error;
  }
}

async function getMarketDetails(marketIds) {
  console.log(`Getting details for ${marketIds.length} markets...`);
  const startTime = performance.now();
  
  try {
    const markets = await sql`
      SELECT 
        m.id as market_id,
        m.question,
        m.url,
        m.subtitle,
        m.yes_sub_title,
        m.no_sub_title,
        m.description,
        m.clobtokenids,
        m.outcomes,
        m.active,
        m.closed,
        m.archived,
        m.image,
        m.event_id,
        e.title as event_title
      FROM markets m
      LEFT JOIN events e ON m.event_id = e.id 
      WHERE m.id = ANY(${marketIds})
    `;

    console.log(`Got market details in ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
    return markets;
  } catch (error) {
    console.error('Error getting market details:', error);
    throw error;
  }
}

async function getPriceData(marketIds, timeRange) {
  const { pastDate, now } = timeRange;
  console.log(`Getting price data for ${marketIds.length} markets...`);
  const startTime = performance.now();
  
  try {
    const priceData = await sql`
      WITH latest_prices AS (
        SELECT DISTINCT ON (market_id)
          market_id,
          last_traded_price AS final_last_traded_price,
          best_ask AS final_best_ask,
          best_bid AS final_best_bid,
          volume AS final_volume,
          timestamp AS final_timestamp
        FROM market_prices
        WHERE market_id = ANY(${marketIds}) AND timestamp <= ${now}
        ORDER BY market_id, timestamp DESC
      ),
      initial_prices AS (
        SELECT DISTINCT ON (market_id)
          market_id,
          last_traded_price AS initial_last_traded_price,
          volume AS initial_volume,
          timestamp AS initial_timestamp
        FROM market_prices
        WHERE market_id = ANY(${marketIds}) AND timestamp >= ${pastDate}
        ORDER BY market_id, timestamp ASC
      )
      SELECT 
        m.market_id,
        lp.final_last_traded_price,
        lp.final_best_ask,
        lp.final_best_bid,
        lp.final_volume,
        ip.initial_last_traded_price,
        ip.initial_volume,
        COALESCE(lp.final_last_traded_price, 0) - COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0) as price_change,
        COALESCE(lp.final_volume, 0) - COALESCE(ip.initial_volume, 0) as volume_change,
        CASE 
          WHEN COALESCE(ip.initial_volume, 0) = 0 THEN 
            CASE 
              WHEN COALESCE(lp.final_volume, 0) = 0 THEN 0 
              ELSE 100 
            END
          ELSE ((COALESCE(lp.final_volume, 0) - COALESCE(ip.initial_volume, 0)) / COALESCE(ip.initial_volume, 0)) * 100 
        END as volume_change_percentage
      FROM (SELECT UNNEST(${marketIds}::text[]) as market_id) m
      LEFT JOIN latest_prices lp USING (market_id)
      LEFT JOIN initial_prices ip USING (market_id)
    `;

    console.log(`Got price data in ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
    return priceData;
  } catch (error) {
    console.error('Error getting price data:', error);
    throw error;
  }
}

async function calculatePriceChanges(interval) {
  const startTime = performance.now();
  console.log(`\n=== Starting calculation for ${interval} minute interval ===`);
  
  try {
    const now = new Date();
    const pastDate = new Date(now.getTime() - interval * 60000);
    const timeRange = { pastDate, now };
    
    console.log(`Time range: ${pastDate.toISOString()} to ${now.toISOString()}`);
    
    // Get all active market IDs
    const marketIds = await getActiveMarkets(timeRange);
    const allProcessedData = [];
    
    // Process markets in chunks
    for (let i = 0; i < marketIds.length; i += CHUNK_SIZE) {
      console.log(`\nProcessing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(marketIds.length / CHUNK_SIZE)}...`);
      const chunkStart = performance.now();
      
      try {
        const marketChunk = marketIds.slice(i, i + CHUNK_SIZE);
        const markets = await getMarketDetails(marketChunk);
        const priceData = await getPriceData(marketChunk, timeRange);
        
        const processedChunk = markets.map(market => {
          const prices = priceData.find(p => p.market_id === market.market_id) || {};
          
          return {
            market_id: market.market_id,
            question: market.question,
            url: market.url,
            subtitle: market.subtitle,
            yes_sub_title: market.yes_sub_title,
            no_sub_title: market.no_sub_title,
            description: market.description,
            clobtokenids: market.clobtokenids,
            outcomes: market.outcomes,
            active: market.active,
            closed: market.closed,
            archived: market.archived,
            image: market.image,
            event_id: market.event_id,
            event_title: market.event_title,
            final_last_traded_price: parseFloat(prices.final_last_traded_price) || 0,
            final_best_ask: parseFloat(prices.final_best_ask) || 0,
            final_best_bid: parseFloat(prices.final_best_bid) || 0,
            final_volume: parseFloat(prices.final_volume) || 0,
            initial_last_traded_price: parseFloat(prices.initial_last_traded_price) || 0,
            initial_volume: parseFloat(prices.initial_volume) || 0,
            price_change: parseFloat(prices.price_change) || 0,
            volume_change: parseFloat(prices.volume_change) || 0,
            volume_change_percentage: parseFloat(prices.volume_change_percentage) || 0
          };
        });
        
        allProcessedData.push(...processedChunk);
        
        const chunkTime = (performance.now() - chunkStart) / 1000;
        console.log(`Completed chunk in ${chunkTime.toFixed(2)}s`);
      } catch (error) {
        console.error(`Error processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}:`, error);
        continue;
      }
    }
    
    // Sort by absolute price change
    allProcessedData.sort((a, b) => Math.abs(b.price_change) - Math.abs(a.price_change));
    
    const timestamp = Date.now();
    const key = `topMovers:${interval}:${timestamp}`;
    
    console.log(`\nStoring ${allProcessedData.length} processed markets in Redis...`);
    
    try {
      await redis.pipeline()
        .setex(key, 10000, JSON.stringify(allProcessedData))
        .set(`topMovers:${interval}:latest`, timestamp)
        .exec();
      
      console.log(`Successfully stored data in Redis for ${interval} minute interval`);
      
      // Log summary statistics
      const activePriceChanges = allProcessedData.filter(m => m.price_change !== 0);
      console.log('\nSummary Statistics:');
      console.log(`Total Markets: ${allProcessedData.length}`);
      console.log(`Markets with Price Changes: ${activePriceChanges.length}`);
      if (activePriceChanges.length > 0) {
        console.log(`Average Absolute Price Change: ${(activePriceChanges.reduce((sum, m) => sum + Math.abs(m.price_change), 0) / activePriceChanges.length * 100).toFixed(2)}%`);
      }
    } catch (redisError) {
      console.error(`Redis storage error for ${interval} minute interval:`, redisError);
    }
    
    console.log(`Completed ${interval} minute interval in ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
  } catch (error) {
    console.error(`Error calculating ${interval} minute interval:`, error);
    throw error;
  }
}

async function testOneRun() {
  console.log('Starting test run of price change calculations');
  const startTime = performance.now();
  
  const results = { success: [], failed: [] };
  
  for (const interval of TEST_INTERVALS) {
    try {
      await calculatePriceChanges(interval);
      results.success.push(interval);
    } catch (error) {
      console.error(`Failed to process ${interval} minute interval:`, error);
      results.failed.push(interval);
    }
  }
  
  console.log('\nRun Summary:');
  console.log('Successful intervals:', results.success.join(', '));
  console.log('Failed intervals:', results.failed.join(', '));
  console.log(`Total time: ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
  
  await redis.quit();
}

// Error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

// Run the test
testOneRun().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
