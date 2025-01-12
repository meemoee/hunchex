const { Pool } = require('pg');
const Redis = require('ioredis');
const express = require('express');
const router = express.Router();

const pool = new Pool({
  user: 'market_data_user',
  host: 'market-data-db.cpk8ckae4ddx.us-east-1.rds.amazonaws.com',
  database: 'market_data',
  password: '1pCU8cOG1npoN0d0',
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

const CACHE_EXPIRATION = 300;

async function getTopMovers(interval, page = 1, pageSize = 10, openOnly = false) {
  // Get latest timestamp for this interval
  const latestTimestamp = await redis.get(`topMovers:${interval}:latest`)
  if (!latestTimestamp) {
    console.log('No cached data available, waiting for worker to calculate...')
    return [] // Return empty array while waiting for worker to calculate
  }

  // Get cached data
  const cachedData = await redis.get(`topMovers:${interval}:${latestTimestamp}`)
  if (!cachedData) {
    return []
  }

  let data = JSON.parse(cachedData)

  // Apply openOnly filter if needed
  if (openOnly) {
    data = data.filter(m => m.market_id.includes('-') || (m.active && !m.closed && !m.archived))
  }

  // Handle pagination
  const start = (page - 1) * pageSize
  const end = start + pageSize
  return data.slice(start, end)
}

async function getCachedData(key) {
  try {
    const keys = await redis.keys(`${key}:*`);
    if (keys.length === 0) return null;
    const latestKey = keys.sort().reverse()[0];
    console.log('Cache lookup:', {
      requestedKey: key,
      foundKey: latestKey,
      timestamp: Date.now()
    });
    const cachedData = await redis.get(latestKey);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (error) {
    console.error('Error getting cached data:', error);
    return null;
  }
}

async function setCachedData(key, data, expiration = CACHE_EXPIRATION) {
  try {
    const timestamp = Date.now();
    const newKey = `${key}:${timestamp}`;
    await redis.setex(newKey, expiration, JSON.stringify(data));
    
    const keys = await redis.keys(`${key}:*`);
    if (keys.length > 10) {
      const keysToRemove = keys.sort().slice(0, -10);
      await redis.del(keysToRemove);
    }
  } catch (error) {
    console.error('Error setting cached data:', error);
  }
}

async function updateTickerCache() {
  console.log('Updating ticker cache...');
  const intervals = [15, 60, 240, 1440];
  for (const interval of intervals) {
    try {
      const allTickers = await getTopMovers(interval);
      await setCachedData(`topMovers:${interval}`, allTickers);
      console.log(`Updated cache for interval: ${interval}`);
    } catch (error) {
      console.error(`Error updating cache for interval ${interval}:`, error);
    }
  }
}

async function fetchAdditionalDetails(topMovers) {
  return topMovers.map(mover => ({
    ...mover,
    final_last_traded_price: parseFloat(mover.final_last_traded_price),
    price_change: parseFloat(mover.price_change),
    initial_last_traded_price: parseFloat(mover.initial_last_traded_price),
    final_yes_price: parseFloat(mover.final_yes_price),
    final_no_price: parseFloat(mover.final_no_price),
    final_best_bid: parseFloat(mover.final_best_bid),
    final_best_ask: parseFloat(mover.final_best_ask),
    volume: parseFloat(mover.final_volume || 0),
    volume_change: parseFloat(mover.volume_change || 0),
    volume_change_percentage: parseFloat(mover.volume_change_percentage || 0),
    clobtokenids: mover.clobtokenids,
    image: mover.image && mover.image !== '0' && mover.image !== 'null' && mover.image !== '' ? mover.image : '/images/placeholder.png'
  }));
}

async function findSimilarMarkets(embedding, limit = 3) {
  const embeddingString = JSON.stringify(embedding);
  const currentDate = new Date().toISOString();
  const query = `
    SELECT m.id, 
           m.question,
           m.subtitle,
           m.url,
           m.description,
           m.end_date,
           m.event_id,
           m.condid,
           m.slug,
           m.outcomes,
           m.group_item_title,
           m.open_time,
           m.close_time,
           m.status,
           m.clobtokenids,
           m.active,
           m.closed,
           m.archived,
           1 - (me.embedding <=> $1::vector) AS cosine_similarity
    FROM market_embeddings me
    JOIN markets m ON me.market_id = m.id
    WHERE m.end_date > $2
      AND (
        (m.id NOT LIKE '%-%' AND m.active = true AND m.closed = false AND m.archived = false)
        OR m.id LIKE '%-%'
      )
    ORDER BY cosine_similarity DESC
    LIMIT $3
  `;
  
  try {
    const result = await pool.query(query, [embeddingString, currentDate, limit]);
    console.log(`Found ${result.rows.length} similar markets`);
    result.rows.forEach(market => {
      console.log(`Market ID: ${market.id}, End Date: ${market.end_date}, Similarity: ${market.cosine_similarity}`);
    });
    return result.rows;
  } catch (error) {
    console.error('Error in findSimilarMarkets:', error);
    throw error;
  }
}

async function updateQuoteConfirmations(quoteId, confirmations) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete existing confirmations
    await client.query('DELETE FROM quote_confirmations WHERE quote_id = $1', [quoteId]);
    
    // Insert new confirmations
    for (const confirmation of confirmations) {
      await client.query(
        'INSERT INTO quote_confirmations (quote_id, confirming_url, date_said, date_precision, chain_of_thought) VALUES ($1, $2, $3, $4, $5)',
        [quoteId, confirmation.confirming_url, confirmation.date_said, confirmation.date_precision, JSON.stringify(confirmation.chain_of_thought)]
      );
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findSimilarEvents(embedding, limit = 3) {
  const embeddingString = JSON.stringify(embedding);
  const query = `
    WITH similar_events AS (
      SELECT e.*, 1 - (ee.embedding <=> $1::vector) AS cosine_similarity
      FROM event_embeddings ee
      JOIN events e ON ee.event_id = e.id
      ORDER BY cosine_similarity DESC
      LIMIT $2
    )
    SELECT 
      se.id AS event_id, 
      se.title AS event_title, 
      se.slug AS event_slug, 
      se.category AS event_category, 
      se.sub_title AS event_sub_title, 
      se.mutually_exclusive AS event_mutually_exclusive,
      se.cosine_similarity,
      m.id AS market_id, 
      m.question, 
      m.subtitle, 
      m.url, 
      m.condid, 
      m.slug AS market_slug, 
      m.end_date, 
      m.description, 
      m.outcomes, 
      m.group_item_title, 
      m.open_time, 
      m.close_time, 
      m.status, 
      m.clobtokenids
    FROM similar_events se
    LEFT JOIN markets m ON se.id = m.event_id
    ORDER BY se.cosine_similarity DESC, m.id
  `;
  
  const result = await pool.query(query, [embeddingString, limit]);
  return result.rows;
}


async function searchQuotes(search, person, page, pageSize) {
  console.log(`Received search quotes request with query: ${search}, person: ${person}, page: ${page}, pageSize: ${pageSize}`);

  const cacheKey = `searchQuotes:${search}:${person}:${page}:${pageSize}`;
  let searchResults = await getCachedData(cacheKey);

  if (!searchResults) {
    console.log(`Cache miss for ${cacheKey}, querying database directly`);
    const client = await pool.connect();
    try {
      let query = `
        WITH matched_quotes AS (
          SELECT 
            pq.id,
            pq.person_name,
            pq.quote_text,
            pq.quote_context,
            pq.publish_date,
            pq.date_said,
            pq.url,
            pq.authors,
            pq.site_name,
            COALESCE(pq.is_direct, false) as is_direct
          FROM 
            person_quotes pq
          WHERE 
            to_tsvector('english', pq.quote_text || ' ' || pq.quote_context || ' ' || pq.person_name) @@ plainto_tsquery('english', $1)
            ${person ? "AND pq.person_name ILIKE $2" : ""}
          ORDER BY 
            pq.publish_date DESC
          LIMIT $${person ? 3 : 2} OFFSET $${person ? 4 : 3}
        )
        SELECT 
          mq.*,
          json_agg(DISTINCT jsonb_build_object(
            'similar_quote_id', rq.similar_quote_id,
            'quote_text', sq.quote_text,
            'quote_context', sq.quote_context,
            'publish_date', sq.publish_date,
            'url', sq.url,
            'similarity_score', rq.similarity_score
          )) FILTER (WHERE rq.similar_quote_id IS NOT NULL) AS relevant_quotes,
          json_agg(DISTINCT jsonb_build_object(
            'category_id', qcp.category_id,
            'category_name', ce.category_name,
            'percentage', qcp.percentage
          )) FILTER (WHERE qcp.category_id IS NOT NULL) AS category_percentages,
          json_agg(DISTINCT jsonb_build_object(
            'market_id', rm.market_id,
            'question', m.question,
            'subtitle', m.subtitle,
            'url', m.url,
            'description', m.description,
            'similarity_score', rm.similarity_score
          )) FILTER (WHERE rm.market_id IS NOT NULL) AS relevant_markets,
          (
            SELECT jsonb_agg(jsonb_build_object('date_said', qc.date_said, 'confirming_url', qc.confirming_url))
            FROM quote_confirmations qc
            WHERE qc.quote_id = mq.id
            ORDER BY qc.date_said DESC
            LIMIT 1
          ) AS most_recent_confirmation
        FROM 
          matched_quotes mq
        LEFT JOIN relevant_quotes_for_quotes rq ON mq.id = rq.quote_id
        LEFT JOIN person_quotes sq ON rq.similar_quote_id = sq.id
        LEFT JOIN quote_category_percentages qcp ON mq.id = qcp.quote_id
        LEFT JOIN category_embeddings ce ON qcp.category_id = ce.id
        LEFT JOIN relevant_markets_for_quotes rm ON mq.id = rm.quote_id
        LEFT JOIN markets m ON rm.market_id::text = m.id::text
        GROUP BY 
          mq.id, mq.person_name, mq.quote_text, mq.quote_context, mq.publish_date, 
          mq.date_said, mq.url, mq.authors, mq.site_name, mq.is_direct
        ORDER BY 
          COALESCE((most_recent_confirmation->0->>'date_said')::timestamp, mq.date_said, mq.publish_date) DESC
      `;

      const queryParams = [search];
      if (person) {
        queryParams.push(`%${person}%`);
      }
      const offset = (page - 1) * pageSize;
      queryParams.push(pageSize, offset);

      const result = await client.query(query, queryParams);
      
      searchResults = result.rows.map(row => ({
        ...row,
        authors: row.authors ? JSON.parse(row.authors) : [],
        relevant_quotes: row.relevant_quotes || [],
        category_percentages: row.category_percentages ? row.category_percentages.reduce((acc, cat) => {
          acc[cat.category_name] = parseFloat(cat.percentage);
          return acc;
        }, {}) : {},
        relevant_markets: row.relevant_markets || []
      }));

      await setCachedData(cacheKey, searchResults, 3600); // Cache for 1 hour
    } finally {
      client.release();
    }
  }

  return searchResults;
}

async function saveAnalysisResult(marketId, result) {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO analysis_results (market_id, result) VALUES ($1, $2) ON CONFLICT (market_id) DO UPDATE SET result = $2',
      [marketId, result]
    );
  } catch (err) {
    console.error('Error saving analysis result:', err);
  } finally {
    client.release();
  }
}

async function saveTimelineResult(marketId, result) {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO timeline_results (market_id, result) VALUES ($1, $2) ON CONFLICT (market_id) DO UPDATE SET result = $2',
      [marketId, result]
    );
  } catch (err) {
    console.error('Error saving timeline result:', err);
  } finally {
    client.release();
  }
}

router.get('/:profileName', async (req, res) => {
  const { profileName } = req.params;
  const client = await pool.connect();
  try {
    // Fetch profile information
    const profileResult = await client.query(`
      SELECT p.name, p.description, p.avatar_url, COALESCE(SUM(nf.count), 0) as total_count
      FROM person p
      LEFT JOIN name_frequency nf ON p.name = nf.person_name
      WHERE p.name = $1
      GROUP BY p.name, p.description, p.avatar_url
    `, [profileName]);

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = profileResult.rows[0];

    // Fetch quotes for the profile
    const quotesResult = await client.query(`
      SELECT pq.id, pq.quote_text, pq.quote_context, pq.publish_date, pq.date_said, pq.url, pq.authors, pq.site_name, COALESCE(pq.is_direct, false) as is_direct
      FROM person_quotes pq
      WHERE pq.person_name = $1
      ORDER BY pq.publish_date DESC
    `, [profileName]);

    // Fetch relevant quotes, category percentages, and quote confirmations for each quote
    const quotesWithRelevantQuotes = await Promise.all(quotesResult.rows.map(async (quote) => {
      const relevantQuotesResult = await client.query(`
        SELECT rq.similar_quote_id, pq.quote_text, pq.quote_context, pq.publish_date, pq.url, rq.similarity_score
        FROM relevant_quotes_for_quotes rq
        JOIN person_quotes pq ON rq.similar_quote_id = pq.id
        WHERE rq.quote_id = $1
        ORDER BY rq.similarity_score DESC
        LIMIT 5
      `, [quote.id]);

      const categoryPercentagesResult = await client.query(`
        SELECT qcp.category_id, ce.category_name, qcp.percentage
        FROM quote_category_percentages qcp
        JOIN category_embeddings ce ON qcp.category_id = ce.id
        WHERE qcp.quote_id = $1
        ORDER BY qcp.percentage DESC
      `, [quote.id]);

      // Fetch relevant markets
      const relevantMarketsResult = await client.query(`
        SELECT rm.market_id, m.question, m.subtitle, m.url, m.description, rm.similarity_score,
               m.active, m.closed, m.archived, m.end_date, m.condid, m.slug, m.outcomes,
               m.group_item_title, m.open_time, m.close_time, m.status, m.clobtokenids
        FROM relevant_markets_for_quotes rm
        JOIN markets m ON rm.market_id::text = m.id::text
        WHERE rm.quote_id = $1
          AND (
            m.id LIKE '%-%'
            OR (m.active = true AND m.closed = false AND m.archived = false)
          )
        ORDER BY rm.similarity_score DESC
        LIMIT 5
      `, [quote.id]);

      // Fetch quote confirmations
      const quoteConfirmationsResult = await client.query(`
        SELECT confirming_url, date_said, date_precision, chain_of_thought
        FROM quote_confirmations
        WHERE quote_id = $1
        ORDER BY date_said DESC
      `, [quote.id]);

      // Filter and process relevant markets
      const processedRelevantMarkets = relevantMarketsResult.rows.map(market => ({
        market_id: market.market_id,
        question: market.question,
        subtitle: market.subtitle,
        url: market.url,
        description: market.description,
        similarity_score: market.similarity_score,
        end_date: market.end_date,
        condid: market.condid,
        slug: market.slug,
        outcomes: market.outcomes,
        group_item_title: market.group_item_title,
        open_time: market.open_time,
        close_time: market.close_time,
        status: market.status,
        clobtokenids: market.clobtokenids,
        active: market.active,
        closed: market.closed,
        archived: market.archived
      }));

      return {
        ...quote,
        relevantQuotes: relevantQuotesResult.rows,
        relevantMarkets: processedRelevantMarkets,
        category_percentages: categoryPercentagesResult.rows.reduce((acc, row) => {
          acc[row.category_name] = parseFloat(row.percentage);
          return acc;
        }, {}),
        authors: quote.authors ? JSON.parse(quote.authors) : [],
        site_name: quote.site_name || 'Unknown',
        confirmations: quoteConfirmationsResult.rows
      };
    }));

    // Generate mock portfolio data (replace this with actual data fetching logic)
    const portfolio = {
      prediction: [
        { market: "Market A", position: "Yes", amount: 100, probability: 0.7, portfolioWeight: 40, pnl: 25.50, analysis: "This holding represents a significant portion of the portfolio, showing strong conviction in the outcome. The positive PnL indicates a good performance so far." },
        { market: "Market B", position: "No", amount: 50, probability: 0.3, portfolioWeight: 20, pnl: -10.25, analysis: "This contrarian position has underperformed so far, but its smaller portfolio weight limits the overall impact on the portfolio." },
      ],
      preference: [
        { market: "Market C", position: "Yes", amount: 75, probability: 0.6, portfolioWeight: 30, pnl: 15.75, analysis: "This holding aligns with the individual's preferences and has shown positive performance, contributing significantly to the portfolio." },
      ],
      prudence: [
        { market: "Market D", position: "No", amount: 25, probability: 0.4, portfolioWeight: 10, pnl: 5.00, analysis: "This small, prudent position has yielded a modest positive return, serving as a hedge against other holdings." },
      ],
    };

    res.json({
      name: profile.name,
      description: profile.description,
      image: profile.avatar_url || `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
      totalCount: parseInt(profile.total_count),
      quotes: quotesWithRelevantQuotes,
      portfolio: portfolio
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});



module.exports = {
  profileRoutes: router,
  getTopMovers,
  saveTimelineResult,
  getCachedData,
  saveAnalysisResult,
  setCachedData,
  updateQuoteConfirmations,
  updateTickerCache,
  fetchAdditionalDetails,
  findSimilarMarkets,
  findSimilarEvents,
  searchQuotes,
  pool,
  redis
};