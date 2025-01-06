const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const moment = require('moment');
const { spawn, exec } = require('child_process');
const { OrderManager, OrderType, OrderSide } = require('./orderManager');
const { processFinalResponse } = require('./perpanalysis');
const PolyOrderbook = require('./polyOrderbook');

const WebSocket = require('ws');
const http = require('http');
const PolymarketStream = require('./polymarketStream');
const KalshiStream = require('./kalshiStream');
const axios = require('axios');
const { OpenAI } = require('openai');
const { auth } = require('express-oauth2-jwt-bearer');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const clients = new Map(); // Map of clientId to WebSocket
const userSockets = new Map(); // Map of userId to Set of WebSocket connections

function addUserSocket(userId, ws) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(ws);
}

function removeUserSocket(userId, ws) {
  if (userSockets.has(userId)) {
    userSockets.get(userId).delete(ws);
    if (userSockets.get(userId).size === 0) {
      userSockets.delete(userId);
    }
  }
}

function broadcastToUser(userId, data) {
  if (userSockets.has(userId)) {
    userSockets.get(userId).forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }
}

// Logger setup
const logger = {
  debug: (...args) => console.log(new Date().toISOString(), '- DEBUG -', ...args),
  error: (...args) => console.error(new Date().toISOString(), '- ERROR -', ...args)
};

// OpenRouter constants
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const { 
    getStructuredQuery,
    getCachedMarketData,
    processMarketQuery,
    synthesizeResults 
} = require('./LLMpandasSimple');
const { Decimal } = require('decimal.js');

const app = express();
const port = 3001;



const {
  profileRoutes, 
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
  redis
} = require('./serverUtils');



const polyOrderbook = new PolyOrderbook();
const sql = neon(process.env.DATABASE_URL);
const orderManager = new OrderManager(sql, redis, polyOrderbook);

// Auth0 configuration
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256'
});

// OpenAI API key and client
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });



// Embedding model
const EMBEDDING_MODEL = "text-embedding-ada-002";

class IndividualQuestions {
  constructor(name, questions) {
    this.name = name;
    this.questions = questions;
  }
}

const POLY_API_URL = 'https://clob.polymarket.com';
const KALSHI_API_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_API_FALLBACK_URL = 'https://trading-api.kalshi.com/trade-api/v2';
const KALSHI_EMAIL = 'tem-tam@hotmail.com';
const KALSHI_PASSWORD = '$P1derman';

// Token storage with timestamps
let kalshiTokens = {
  elections: { token: null, userId: null, timestamp: null },
  legacy: { token: null, userId: null, timestamp: null }
};

async function authenticateKalshiLegacy() {
  try {
    const response = await axios.post(`${KALSHI_API_FALLBACK_URL}/login`, {
      email: KALSHI_EMAIL,
      password: KALSHI_PASSWORD
    });
    
    if (response.status === 200) {
      kalshiTokens.legacy = {
        token: response.data.token,
        userId: response.data.member_id,
        timestamp: Date.now()
      };
      return kalshiTokens.legacy;
    }
    throw new Error('Legacy authentication failed');
  } catch (error) {
    console.error('Kalshi legacy authentication error:', error);
    throw error;
  }
}

async function authenticateKalshiElections() {
  try {
    const response = await axios.post(`${KALSHI_API_BASE_URL}/login`, {
      email: KALSHI_EMAIL,
      password: KALSHI_PASSWORD
    });
    
    if (response.status === 200) {
      kalshiTokens.elections = {
        token: response.data.token,
        userId: response.data.member_id,
        timestamp: Date.now()
      };
      return kalshiTokens.elections;
    }
    throw new Error('Elections authentication failed');
  } catch (error) {
    console.error('Kalshi elections authentication error:', error);
    throw error;
  }
}

const CACHE_UPDATE_INTERVAL = 5 * 60 * 1000;
const UNIQUE_TICKERS_UPDATE_INTERVAL = 15 * 60 * 1000;

// Update the Express app configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
// Add secure headers middleware
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

async function invalidateHoldingsCache(userId) {
  const cacheKey = `holdings:${userId}`;
  await redis.del(cacheKey);
}

async function addHolding(userId, marketId, position, amount, price) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check user's balance
    const balanceResult = await client.query('SELECT balance FROM user_balances WHERE user_id = $1 FOR UPDATE', [userId]);
    if (balanceResult.rows.length === 0) {
      throw new Error('User balance not found');
    }
    const currentBalance = parseFloat(balanceResult.rows[0].balance);
    const cost = amount * price;

    if (currentBalance < cost) {
      throw new Error('Insufficient balance');
    }

    // Deduct the cost from the user's balance
    const newBalance = currentBalance - cost;
    await client.query('UPDATE user_balances SET balance = $1 WHERE user_id = $2', [newBalance, userId]);
    
    // Notify connected clients about balance update
    broadcastToUser(userId, {
      type: 'balance_update',
      balance: newBalance,
      timestamp: new Date().toISOString()
    });

    // Add the holding
    await client.query('INSERT INTO holdings (user_id, market_id, position, amount) VALUES ($1, $2, $3, $4)', [userId, marketId, position, amount]);

    await client.query('COMMIT');

    // Invalidate the holdings cache
    await invalidateHoldingsCache(userId);

    // Update user value history
    await updateUserValueHistory(userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getHoldings(userId) {
  console.log("\n=== GET HOLDINGS START ===");
  
  // Try to get from cache first
  const cacheKey = `holdings:${userId}`;
  const cachedHoldings = await redis.get(cacheKey);
  if (cachedHoldings) {
    console.log("Cache hit:", cachedHoldings);
    return JSON.parse(cachedHoldings);
  }

  console.log("Cache miss, querying database");

  // First, verify we have price data
  const priceCheck = await sql`
    SELECT COUNT(*) 
    FROM market_prices 
    WHERE timestamp >= NOW() - INTERVAL '24 hours'
  `;
  console.log("Price records in last 24h:", priceCheck[0].count);

  // Then check our holdings
  const holdingsCheck = await sql`
    SELECT COUNT(*) 
    FROM holdings 
    WHERE user_id = ${userId}
  `;
  console.log("Holdings for user:", holdingsCheck[0].count);

  // Now run full query with logging
  const holdings = await sql`
    WITH latest_prices AS (
        SELECT DISTINCT ON (market_id) 
            market_id,
            yes_price,
            no_price,
            best_ask,
            best_bid,
            last_traded_price,
            timestamp
        FROM market_prices
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        ORDER BY market_id, timestamp DESC
    )
    SELECT 
        h.id,
        h.user_id,
        h.market_id,
        h.token_id,
        h.outcome,
        h.position,
        h.amount,
        h.entry_price,
        h.created_at,
        m.question,
        m.image,
        CASE 
            WHEN UPPER(h.outcome) = 'YES' THEN
                COALESCE(lp.yes_price, lp.best_ask, lp.last_traded_price, 0)
            WHEN UPPER(h.outcome) = 'NO' THEN
                COALESCE(lp.no_price, 1 - lp.best_bid, 1 - lp.last_traded_price, 0)
            ELSE
                COALESCE(lp.last_traded_price, lp.best_bid, 0)
        END as current_price
    FROM holdings h
    JOIN markets m ON h.market_id = m.id
    LEFT JOIN latest_prices lp ON h.market_id = lp.market_id
    WHERE h.user_id = ${userId}
`;

  console.log("Raw holdings response:", JSON.stringify(holdings, null, 2));
  console.log("First holding fields:", holdings[0] ? Object.keys(holdings[0]) : 'No holdings');
  console.log("=== GET HOLDINGS END ===\n");

  await redis.setex(cacheKey, 300, JSON.stringify(holdings));
  return holdings;
}

function generateToken(userId) {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
  const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.userId;
  } catch (error) {
    return null;
  }
}





setInterval(updateTickerCache, CACHE_UPDATE_INTERVAL);


// Update the chain IDs endpoint
app.get('/api/summary-chain-ids/:marketId', async (req, res) => {
  const { marketId } = req.params;
  try {
    const result = await pool.query(
      'SELECT DISTINCT chain_id FROM summary_message_history WHERE market_id = $1 ORDER BY chain_id DESC',
      [marketId]
    );
    res.json(result.rows.map(row => row.chain_id));
  } catch (error) {
    console.error('Error fetching summary chain IDs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the messages endpoint
app.get('/api/messages/:marketId/:chainId', async (req, res) => {
  const { marketId, chainId } = req.params;
  try {
    const result = await pool.query(
      'SELECT message_order, side, content FROM market_message_history WHERE market_id = $1 AND chain_id = $2 ORDER BY message_order',
      [marketId, chainId]
    );
    res.json(result.rows.map(row => ({
      order: row.message_order,
      side: row.side,
      content: row.content
    })));
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/summary-messages/:marketId/:chainId', async (req, res) => {
  const { marketId, chainId } = req.params;
  try {
    const result = await pool.query(
      'SELECT message_order, side, content FROM summary_message_history WHERE market_id = $1 AND chain_id = $2 ORDER BY message_order',
      [marketId, chainId]
    );
    res.json(result.rows.map(row => ({
      order: row.message_order,
      side: row.side,
      content: row.content
    })));
  } catch (error) {
    console.error('Error fetching summary messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/top_movers', async (req, res) => {
  console.log('Received request for top movers');
  const interval = parseInt(req.query.interval) || 240;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const openOnly = req.query.openOnly === 'true';
  
  console.log(`Processing request - Interval: ${interval}, Page: ${page}, PageSize: ${pageSize}, OpenOnly: ${openOnly}`);
  
  try {
    const cacheKey = `topMovers:${interval}:${page}:${pageSize}:${openOnly}`;
    let topMovers = await getCachedData(cacheKey);
    
    if (!topMovers) {
      console.log('Cache miss, fetching from database');
      topMovers = await getTopMovers(interval, page, pageSize, openOnly);
      console.log(`Fetched ${topMovers.length} movers from database`);
      await setCachedData(cacheKey, topMovers);
    }

    console.log('Processing top movers');
    const processedTopMovers = await fetchAdditionalDetails(topMovers);
    console.log(`Sending ${processedTopMovers.length} processed movers`);

    res.json(processedTopMovers);
  } catch (error) {
    console.error('Error in /api/top_movers:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

const runPythonScript = (scriptName, args) => {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to run Python script: ${scriptName} with args: ${args.join(', ')}`);
    const process = spawn('python', [scriptName, ...args]);
    let output = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
      console.log(`Python script output: ${data}`);
    });

    process.stderr.on('data', (data) => {
      console.error(`Error from ${scriptName}:`, data.toString());
    });

    process.on('close', (code) => {
      if (code !== 0) {
        console.error(`${scriptName} exited with code ${code}`);
        reject(`${scriptName} exited with code ${code}`);
      } else {
        console.log(`Python script ${scriptName} completed successfully`);
        resolve(output.trim());
      }
    });
  });
};

const runJavaScriptScript = (scriptName, args) => {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to run JavaScript script: ${scriptName} with args: ${args.join(' ')}`);
    exec(`node ${scriptName} ${args.join(' ')}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing ${scriptName}:`, error);
        console.error(`Stderr: ${stderr}`);
        reject(`${scriptName} exited with error: ${error.message}`);
      } else {
        console.log(`JavaScript script ${scriptName} executed successfully. Output: ${stdout}`);
        resolve(stdout.trim());
      }
    });
  });
};

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const userId = await createUser(username, password);
    const token = generateToken(userId);
    res.json({ token });
  } catch (error) {
    console.error('Error in /api/register:', error);
    res.status(500).json({ error: 'Error registering user', details: error.message });
  }
});

// Add new endpoint for order submission

app.post('/api/submit-order', async (req, res) => {
  console.log('\n=== EXPRESS BACKEND START ===');
  
  try {
    console.log('1. Express received request');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);

    const authHeader = req.headers.authorization;
    const userId = req.headers['x-user-id'];

    console.log('2. Auth check:', {
      hasAuthHeader: !!authHeader,
      hasUserId: !!userId
    });

    if (!authHeader || !userId) {
      console.error('3. Missing authentication');
      return res.status(401).json({ error: 'Authentication required' });
    }

    console.log('4. Getting market info...');
    const marketInfo = await sql`
      SELECT clobtokenids FROM markets WHERE id = ${req.body.marketId}
    `;
    console.log('5. Market info result:', marketInfo[0]);

    const tokenId = JSON.parse(marketInfo[0].clobtokenids)[0];
    console.log('6. TokenId:', tokenId);

    console.log('7. Attempting order via OrderManager...');
    let result;
    if (req.body.price) {
      console.log('8a. Submitting limit order...');
      result = await orderManager.submitLimitOrder(
		userId, 
		req.body.marketId, 
		tokenId,
		req.body.outcome,
		req.body.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,  // Use the enum
		req.body.size,
		req.body.price
	);
    } else {
      console.log('8b. Executing market order...');
      result = await orderManager.executeMarketOrder(
		  userId,
		  req.body.marketId,
		  tokenId,
		  req.body.outcome,
		  req.body.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,  // Use the enum
		  req.body.size
		);
    }

    console.log('9. Order result:', result);
    console.log('Debug (dataServer): About to broadcast order_execution with userId =', userId);
    
    // Broadcast order execution update to user
    console.log('Debug (dataServer): broadcastToUser triggered for userId:', userId, 'Event data:', { 
      type: 'order_execution', 
      needsHoldingsRefresh: !req.body.price,
      timestamp: new Date().toISOString(),
      orderId: result.orderId,
      orderType: req.body.price ? 'limit' : 'market'
    });
    broadcastToUser(userId, {
      type: 'order_execution',
      needsHoldingsRefresh: !req.body.price, // true for market orders
      timestamp: new Date().toISOString(),
      orderId: result.orderId,
      orderType: req.body.price ? 'limit' : 'market'
    });

    res.json(result);

  } catch (error) {
    console.error('ERROR in Express:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  } finally {
    console.log('=== EXPRESS BACKEND END ===\n');
  }
});

app.post('/api/invalidate-holdings', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await invalidateHoldingsCache(userId);
    
    // Notify connected clients about holdings update
    broadcastToUser(userId, {
      type: 'holdings_update',
      timestamp: new Date().toISOString()
    });
    
    res.json({ message: 'Cache invalidated successfully' });
  } catch (error) {
    console.error('Error invalidating holdings cache:', error);
    res.status(500).json({ error: 'Error invalidating cache' });
  }
});

app.delete('/api/orders/:orderId', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { orderId } = req.params;

  try {
    // Verify the order belongs to the user
    const orderCheck = await pool.query(
      'SELECT user_id FROM active_orders WHERE id = $1',
      [orderId]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (orderCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to cancel this order' });
    }

    // Cancel the order
    await pool.query(
      'UPDATE active_orders SET status = $1 WHERE id = $2',
      ['cancelled', orderId]
    );

    // Notify connected clients about order update
    broadcastToUser(userId, {
      type: 'active_orders_update',
      timestamp: new Date().toISOString()
    });

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ error: 'Error cancelling order', details: error.toString() });
  }
});

// Add this to dataServer.js with the other routes
app.post('/api/invalidate-holdings', async (req, res) => {
  const userId = req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(401).json({ error: 'User ID required' });
  }

  try {
    await invalidateHoldingsCache(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error invalidating holdings cache:', error);
    res.status(500).json({ 
      error: 'Error invalidating cache', 
      details: error.toString() 
    });
  }
});

async function getHoldingByUserAndMarket(userId, marketId) {
  const query = 'SELECT * FROM holdings WHERE user_id = $1 AND market_id = $2';
  const values = [userId, marketId];
  const result = await pool.query(query, values);
  return result.rows[0];
}

async function updateHolding(holdingId, position, amount) {
  const query = 'UPDATE holdings SET position = $1, amount = amount + $2 WHERE id = $3';
  const values = [position, amount, holdingId];
  await pool.query(query, values);
}

app.get('/api/active-orders', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const query = `
      SELECT 
        ao.*,
        m.question,
        m.subtitle,
        m.url,
        m.description,
        m.outcomes,
        m.image
      FROM active_orders ao
      JOIN markets m ON ao.market_id = m.id
      WHERE ao.user_id = $1 AND ao.status = 'active'
      ORDER BY ao.created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    
    const orders = result.rows.map(row => ({
      id: row.id,
      market_id: row.market_id,
      token_id: row.token_id,
      outcome: row.outcome,
      side: row.side,
      size: row.size,
      limit_price: row.limit_price,
      order_type: row.order_type,
      status: row.status,
      created_at: row.created_at,
      // Market details
      question: row.question,
      subtitle: row.subtitle,
      url: row.url,
      description: row.description,
      outcomes: row.outcomes,
      image: row.image && row.image !== '0' && row.image !== 'null' && row.image !== '' ? 
        row.image : '/images/placeholder.png'
    }));

    res.json(orders);
  } catch (error) {
    console.error('Error in /api/active-orders:', error);
    res.status(500).json({ error: 'Error fetching active orders', details: error.toString() });
  }
});

app.get('/api/holdings', checkJwt, async (req, res) => {
  const userId = req.auth.sub; // Auth0 user ID
  try {
    const holdings = await getHoldings(userId);
    res.json(holdings);
  } catch (error) {
    console.error('Error in /api/holdings:', error);
    res.status(500).json({ error: 'Error fetching holdings', details: error.toString() });
  }
});

app.get('/api/balance', checkJwt, async (req, res) => {
  const userId = req.auth.sub; // Auth0 user ID
  try {
    const balance = await getUserBalance(userId);
    res.json({ balance });
  } catch (error) {
    console.error('Error in /api/balance:', error);
    res.status(500).json({ error: 'Error fetching balance', details: error.toString() });
  }
});

app.get('/api/value-history', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { startDate, endDate } = req.query;
  try {
    const history = await getUserValueHistory(userId, startDate, endDate);
    res.json(history);
  } catch (error) {
    console.error('Error in /api/value-history:', error);
    res.status(500).json({ error: 'Error fetching value history', details: error.toString() });
  }
});

async function getUserBalance(userId) {
  try {
    const result = await sql`
      SELECT balance 
      FROM user_balances 
      WHERE user_id = ${userId}
    `;
    if (result.length > 0) {
      return parseFloat(result[0].balance);
    } else {
      return 0; // Return 0 if no balance found for the user
    }
  } catch (error) {
    console.error('Error fetching user balance:', error);
    throw error;
  }
}

async function updateUserValueHistory(userId) {
  const client = await pool.connect();
  try {
    const balance = await getUserBalance(userId);
    const holdings = await getHoldings(userId);
    const holdingsValue = holdings.reduce((total, holding) => {
      return total + (holding.amount * (holding.current_price || 0));
    }, 0);
    const totalValue = balance + holdingsValue;

    await client.query(
      'INSERT INTO user_value_history (user_id, total_value) VALUES ($1, $2)',
      [userId, totalValue]
    );
  } catch (error) {
    console.error('Error updating user value history:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function getUserValueHistory(userId, startDate, endDate) {
  // Try cache first
  const cacheKey = `value_history:${userId}:${startDate}:${endDate}`;
  const cachedHistory = await redis.get(cacheKey);
  if (cachedHistory) {
    return JSON.parse(cachedHistory);
  }

  const client = await pool.connect();
  try {
    // Get daily aggregated values instead of every data point
    const result = await client.query(`
      SELECT 
        date_trunc('day', timestamp) as day,
        AVG(total_value) as total_value
      FROM user_value_history 
      WHERE user_id = $1 
        AND timestamp BETWEEN $2 AND $3
      GROUP BY date_trunc('day', timestamp)
      ORDER BY day
    `, [userId, startDate, endDate]);

    const history = result.rows;
    
    // Cache for 1 hour since historical data changes less frequently
    await redis.setex(cacheKey, 3600, JSON.stringify(history));
    
    return history;
  } catch (error) {
    console.error('Error fetching user value history:', error);
    throw error;
  } finally {
    client.release();
  }
}

app.post('/api/analyze', async (req, res) => {
  const { market_id, question, url, subtitle, description } = req.body;
  console.log(`Received analyze request for market ID: ${market_id}`);
  
  const cachedResult = await getCachedData(`analysis:${market_id}`);
  if (cachedResult) {
    return res.json({ message: JSON.parse(cachedResult) });
  }
  
  try {
    console.log('Attempting to run perpanalysis.js');
    const result = await processFinalResponse(market_id, description);
    console.log('perpanalysis.js executed successfully');
    await saveAnalysisResult(market_id, JSON.stringify(result));
    await setCachedData(`analysis:${market_id}`, JSON.stringify(result), 600); // Cache for 10 minutes
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/analyze:', error);
    res.status(500).json({ error: 'Error analyzing market', details: error.toString() });
  }
});

app.post('/api/reflect-date-said', async (req, res) => {
  const { quoteId } = req.body;
  console.log(`Received reflect date said request for quote ID: ${quoteId}`);

  try {
    console.log('Attempting to run reflectDateSaid.py');
    const result = await runPythonScript('reflectDateSaid.py', [quoteId]);
    console.log('reflectDateSaid.py executed successfully');
    
    // Parse the result and update the database
    const updatedConfirmations = JSON.parse(result);
    await updateQuoteConfirmations(quoteId, updatedConfirmations);

    res.json({ confirmations: updatedConfirmations });
  } catch (error) {
    console.error('Error in /api/reflect-date-said:', error);
    res.status(500).json({ error: 'Error reflecting date said', details: error.toString() });
  }
});


app.post('/api/reddit', async (req, res) => {
  const { market_id, question, url, subtitle } = req.body;
  console.log(`Received Reddit analysis request for market ID: ${market_id}`);
  try {
    console.log('Attempting to run latestpostsanalysis.js');
    const result = await runJavaScriptScript('latestpostsanalysis.js', [market_id]);
    console.log('latestpostsanalysis.js executed successfully');
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/reddit:', error);
    res.status(500).json({ error: 'Error performing Reddit analysis', details: error.toString() });
  }
});

app.post('/api/facts', async (req, res) => {
  const { market_id, question, url, subtitle } = req.body;
  console.log(`Received facts request for market ID: ${market_id}`);
  try {
    console.log('Attempting to run getfacts.js');
    const result = await runJavaScriptScript('getfacts.js', [market_id]);
    console.log('getfacts.js executed successfully');
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/facts:', error);
    res.status(500).json({ error: 'Error fetching facts', details: error.toString() });
  }
});

app.post('/api/analogize', async (req, res) => {
  const { market_id, question, url, subtitle } = req.body;
  console.log(`Received analogize request for market ID: ${market_id}`);
  try {
    console.log('Attempting to run getanalagousevents.js');
    const result = await runJavaScriptScript('getanalagousevents.js', [market_id]);
    console.log('getanalagousevents.js executed successfully');
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/analogize:', error);
    res.status(500).json({ error: 'Error analogizing market', details: error.toString() });
  }
});

app.post('/api/latest_tweets', async (req, res) => {
  const { market_id, question, url, subtitle } = req.body;
  console.log(`Received latest tweets analysis request for market ID: ${market_id}`);
  try {
    console.log('Attempting to run analyzelatesttweets.js');
    const result = await runJavaScriptScript('analyzelatesttweets.js', [market_id]);
    console.log('analyzelatesttweets.js executed successfully');
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/latest_tweets:', error);
    res.status(500).json({ error: 'Error analyzing latest tweets', details: error.toString() });
  }
});

app.post('/api/fetch_kalshi_fields', async (req, res) => {
  const { market_id, url, subtitle } = req.body;
  console.log(`Received fetch Kalshi fields request for URL: ${url}`);
  try {
    console.log('Attempting to run fetch_data.py');
    const result = await runPythonScript('fetch_data.py', ['fetch_kalshi_fields', url, subtitle]);
    console.log('fetch_data.py executed successfully');
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/fetch_kalshi_fields:', error);
    res.status(500).json({ error: 'Error fetching Kalshi fields', details: error.toString() });
  }
});

app.post('/api/chart', async (req, res) => {
  const { market_id, question, url, subtitle } = req.body;
  console.log(`Received chart request for market ID: ${market_id}`);
  try {
    console.log('Attempting to run pricechart.py');
    const result = await runPythonScript('pricechart.py', [market_id]);
    console.log('pricechart.py executed successfully');
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/chart:', error);
    res.status(500).json({ error: 'Error generating chart', details: error.toString() });
  }
});

app.post('/api/timeline', async (req, res) => {
  const { market_id, question, url, subtitle } = req.body;
  console.log(`Received timeline analysis request for market ID: ${market_id}`);
  try {
    console.log('Attempting to run gettimelineevents.js');
    const result = await runJavaScriptScript('gettimelineevents.js', [market_id]);
    console.log('gettimelineevents.js executed successfully');
    await saveTimelineResult(market_id, result);
    res.json({ message: result });
  } catch (error) {
    console.error('Error in /api/timeline:', error);
    res.status(500).json({ error: 'Error performing timeline analysis', details: error.toString() });
  }
});

app.get('/api/profile_names', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT p.name, p.description, p.avatar_url, COALESCE(SUM(nf.count), 0) as total_count
      FROM person p
      LEFT JOIN name_frequency nf ON p.name = nf.person_name
      GROUP BY p.name, p.description, p.avatar_url
      ORDER BY total_count DESC
      LIMIT 50
    `);
    const profiles = result.rows.map(row => ({
      name: row.name,
      description: row.description || '',
      avatar_url: row.avatar_url || `https://i.pravatar.cc/100?img=${Math.floor(Math.random() * 70) + 1}`,
      total_count: parseInt(row.total_count)
    }));
    res.json(profiles);
  } catch (error) {
    console.error('Error fetching profiles:', error);
    res.status(500).json({ error: 'Error fetching profiles' });
  } finally {
    client.release();
  }
});

app.get('/api/relevant_people', async (req, res) => {
  const { description } = req.query;
  if (!description) {
    return res.status(400).json({ error: 'Description is required' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT person_name, count
      FROM name_frequency
      WHERE original_query = $1
      ORDER BY count DESC
      LIMIT 10
    `, [description]);

    if (result.rows.length === 0) {
      return res.json({ message: 'No relevant people found' });
    }

    const relevantPeople = result.rows.map(row => ({
      name: row.person_name,
      count: row.count,
      image: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
      description: `Mentioned ${row.count} times in relation to "${description}"`
    }));

    res.json(relevantPeople);
  } catch (error) {
    console.error('Error fetching relevant people:', error);
    res.status(500).json({ error: 'Error fetching relevant people' });
  } finally {
    client.release();
  }
});

app.get('/api/news_results', async (req, res) => {
  const { description } = req.query;
  if (!description) {
    return res.status(400).json({ error: 'Description is required' });
  }

  console.log('Fetching news results for description:', description);

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT topic, days_back, query, url, summary, date_published, title, is_relevant, image_url, key_facts, key_dates
        FROM news_results
        WHERE topic = $1
        ORDER BY days_back ASC
      `, [description]);

      console.log(`Found ${result.rows.length} news results for description: ${description}`);
      if (result.rows.length > 0) {
        console.log('Sample news result:', JSON.stringify(result.rows[0], null, 2));
      } else {
        console.log('No news results found for this description');
      }

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching news results:', error);
    res.status(500).json({ error: 'Error fetching news results', details: error.message });
  }
});

async function loginToKalshi() {
  const loginUrl = `${KALSHI_API_BASE_URL}/login`;
  const loginPayload = {
    email: KALSHI_EMAIL,
    password: KALSHI_PASSWORD
  };
  
  try {
    const loginResponse = await axios.post(loginUrl, loginPayload, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (loginResponse.status !== 200) {
      throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
    }
    const loginData = loginResponse.data;
    return {
      token: loginData.token,
      userId: loginData.member_id
    };
  } catch (error) {
    console.error('Kalshi login error:', error);
    throw error;
  }
}

// Initialize Polymarket orderbook client


// Get Polymarket orderbook snapshot
app.get('/api/polymarket/orderbook/:marketId', async (req, res) => {
  const { marketId } = req.params;
  
  if (!marketId) {
    return res.status(400).json({ error: 'Market ID is required' });
  }

  try {
    const orderbook = await polyOrderbook.getOrderbookSnapshot(marketId);
    res.json(orderbook);
  } catch (error) {
    console.error('Error fetching Polymarket orderbook:', error);
    res.status(500).json({ 
      error: 'Error fetching orderbook', 
      details: error.response?.data || error.message 
    });
  }
});

app.get('/api/price_history', async (req, res) => {
  const { marketId } = req.query;
  if (!marketId) {
    return res.status(400).json({ error: 'Market ID is required' });
  }

  // Extract series ticker and condition ID for Kalshi markets
  const seriesTicker = marketId.split('-')[0];
  const conditionId = marketId;

  try {
    const result = await sql`SELECT clobtokenids, condid, event_id FROM markets WHERE id = ${marketId}`;
    
    // Explicitly ensure we have a rows property with length
    const queryResult = { 
      rows: result || [],  // Fallback to empty array if result is undefined
      rowCount: result ? result.length : 0
    };

    if (queryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const { clobtokenids, condid, event_id } = queryResult.rows[0];

    const endTs = Math.floor(Date.now() / 1000);
    let startTs;
    let periodInterval;

    const intervalMap = {
      '1d': { duration: 24 * 60 * 60, periodInterval: 1 },
      '1w': { duration: 7 * 24 * 60 * 60, periodInterval: 60 },
      '1m': { duration: 30 * 24 * 60 * 60, periodInterval: 60 },
      '3m': { duration: 90 * 24 * 60 * 60, periodInterval: 60 },
      '1y': { duration: 365 * 24 * 60 * 60, periodInterval: 1440 },
      '5y': { duration: 5 * 365 * 24 * 60 * 60, periodInterval: 1440 }
    };

    const interval = intervalMap[req.query.interval] || intervalMap['1m'];
    startTs = endTs - interval.duration;
    periodInterval = interval.periodInterval;

    console.log(`Fetching price history for interval: ${req.query.interval}, startTs: ${startTs}, endTs: ${endTs}, periodInterval: ${periodInterval}`);

    let formattedData;

    // Check if it's a Kalshi market by looking at the marketId format
    const isKalshiMarket = marketId.includes('-') && !marketId.startsWith('0x');

    // Extract series ticker from market ID
    const seriesTicker = marketId.split('-')[0];
    
    if (marketId.includes('-')) {
      // This is a Kalshi market
      try {
        const candlesticks = await getKalshiMarketCandlesticks(seriesTicker, marketId, startTs, endTs, periodInterval);

        if (!candlesticks || !candlesticks.candlesticks || !Array.isArray(candlesticks.candlesticks)) {
          return res.status(500).json({ error: 'Invalid response from Kalshi API' });
        }

        formattedData = candlesticks.candlesticks.map(candle => ({
          t: new Date(candle.end_period_ts * 1000).toISOString(),
          y: parseFloat(candle.yes_ask.close) / 100 // Convert cents to dollars and to a value between 0 and 1
        }));
      } catch (error) {
        console.error('Error fetching Kalshi data:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'Error fetching Kalshi data', details: error.response ? error.response.data : error.message });
      }
    } else if (clobtokenids) {
      // Polymarket
      const clobTokenIds = JSON.parse(clobtokenids);
      if (clobTokenIds.length === 0) {
        return res.status(404).json({ error: 'No clobTokenIds found for this market' });
      }

      const firstClobTokenId = clobTokenIds[0];

      const response = await axios.get(`${POLY_API_URL}/prices-history`, {
        params: {
          market: firstClobTokenId,
          startTs: startTs,
          endTs: endTs,
          fidelity: periodInterval
        },
        headers: {
          'Authorization': 'Bearer 0x4929c395a0fd63d0eeb6f851e160642bb01975a808bf6119b07e52f3eca4ee69'
        }
      });

      if (!response.data || !response.data.history || !Array.isArray(response.data.history)) {
        return res.status(500).json({ error: 'Invalid response from Polymarket API' });
      }

      formattedData = response.data.history.map(point => ({
        t: new Date(point.t * 1000).toISOString(),
        y: parseFloat(point.p)
      }));
    } else if (isKalshiMarket && condid && event_id) {
      // Kalshi
      try {
        // Split market ID to get series ticker
        const seriesTicker = marketId.split('-')[0];
        const candlesticks = await getKalshiMarketCandlesticks(seriesTicker, marketId, startTs, endTs, periodInterval);

        if (!candlesticks || !candlesticks.candlesticks || !Array.isArray(candlesticks.candlesticks)) {
          return res.status(500).json({ error: 'Invalid response from Kalshi API' });
        }

        formattedData = candlesticks.candlesticks.map(candle => ({
          t: new Date(candle.end_period_ts * 1000).toISOString(),
          y: parseFloat(candle.yes_ask.close) / 100 // Convert cents to dollars and to a value between 0 and 1
        }));
      } catch (error) {
        console.error('Error fetching Kalshi data:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'Error fetching Kalshi data', details: error.response ? error.response.data : error.message });
      }
    } else {
      return res.status(400).json({ error: 'Invalid market type or missing data' });
    }

    res.json(formattedData);
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Error fetching price history', details: error.message });
  }
});


app.post('/api/relevant_events', async (req, res) => {
  const { context } = req.body;
  if (!context) {
    return res.status(400).json({ error: 'Context is required' });
  }

  try {
    const embedding = await generateEmbedding(context);
    const similarEvents = await findSimilarEvents(embedding);
    
    const result = similarEvents.reduce((acc, row) => {
      let event = acc.find(e => e.event_id === row.event_id);
      if (!event) {
        event = {
          event_id: row.event_id,
          event_title: row.event_title,
          event_slug: row.event_slug,
          event_category: row.event_category,
          event_sub_title: row.event_sub_title,
          event_mutually_exclusive: row.event_mutually_exclusive,
          cosine_similarity: row.cosine_similarity,
          markets: []
        };
        acc.push(event);
      }
      
      if (row.market_id && (row.market_id.includes('-') || (row.active && !row.closed && !row.archived))) {
        event.markets.push({
          market_id: row.market_id,
          question: row.question,
          subtitle: row.subtitle,
          url: row.url,
          condid: row.condid,
          market_slug: row.market_slug,
          end_date: row.end_date,
          description: row.description,
          outcomes: row.outcomes,
          group_item_title: row.group_item_title,
          open_time: row.open_time,
          close_time: row.close_time,
          status: row.status,
          clobtokenids: row.clobtokenids
        });
      }
      
      return acc;
    }, []);
    
    res.json(result);
  } catch (error) {
    console.error('Error processing relevant events:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.post('/api/relevant_markets', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const embedding = await generateEmbedding(query);
    const similarMarkets = await findSimilarMarkets(embedding);
    
    const result = similarMarkets.map(market => ({
      market_id: market.id,
      event_id: market.event_id,
      question: market.question,
      subtitle: market.subtitle,
      url: market.url,
      condid: market.condid,
      slug: market.slug,
      end_date: market.end_date,
      description: market.description,
      outcomes: market.outcomes,
      group_item_title: market.group_item_title,
      open_time: market.open_time,
      close_time: market.close_time,
      status: market.status,
      clobtokenids: market.clobtokenids,
      cosine_similarity: market.cosine_similarity,
      active: market.active,
      closed: market.closed,
      archived: market.archived
    })).filter(market => 
      market.market_id.includes('-') || (market.active && !market.closed && !market.archived)
    );
    
    console.log(`Returning ${result.length} similar markets`);
    res.json(result);
  } catch (error) {
    console.error('Error processing relevant markets:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

async function getKalshiMarketCandlesticks(seriesTicker, ticker, startTs, endTs, periodInterval) {
  // Check if elections token needs refresh (older than 55 minutes)
  if (!kalshiTokens.elections.token || 
      !kalshiTokens.elections.timestamp || 
      Date.now() - kalshiTokens.elections.timestamp > 55 * 60 * 1000) {
    await authenticateKalshiElections();
  }

  const { userId, token } = kalshiTokens.elections;
  const candlesticksUrl = `${KALSHI_API_BASE_URL}/series/${seriesTicker}/markets/${ticker}/candlesticks`;
  
  console.log(`Fetching candlesticks from ${KALSHI_API_BASE_URL} for ticker: ${ticker}`);
  
  try {
    const candlesticksResponse = await axios.get(candlesticksUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `${userId} ${token}`
      },
      params: {
        start_ts: startTs,
        end_ts: endTs,
        period_interval: periodInterval
      }
    });
    
    if (candlesticksResponse.status === 200 && 
        candlesticksResponse.data?.candlesticks?.length > 0) {
      return candlesticksResponse.data;
    }
    
    throw new Error(`No candlesticks data returned from ${KALSHI_API_BASE_URL}`);
  } catch (error) {
    console.error(`Error fetching candlesticks from ${KALSHI_API_BASE_URL}:`, error);
    throw error;
  }
}
    

async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

async function parse_with_gpt(raw_content, model_class) {
  const prompt = `Parse the following content into a ${model_class.name} object:\n\n${raw_content}\n\nReturn the result as a JSON object.`;
  
  try {
    const response = await query_perplexity_llm(prompt);
    const parsed_data = JSON.parse(response);
    return new model_class(parsed_data.name, parsed_data.questions);
  } catch (error) {
    console.error("Error parsing with GPT:", error);
    throw error;
  }
}

async function generate_stakeholder_queries(event_description) {
  const prompt = `Given the following event description, generate a list of 3-5 key stakeholders or individuals who are likely to be involved or affected by this event. For each stakeholder, provide a brief explanation of their relevance:\n\n${event_description}`;
  
  try {
    const response = await query_perplexity_llm(prompt);
    return response.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
    console.error("Error generating stakeholder queries:", error);
    throw error;
  }
}

async function get_individuals_for_query(query, event_description) {
  console.log(`Finding individuals for query: ${query}`);
  
  const generate_individuals = async (count) => {
    const prompt = `Given the following event description and stakeholder category, generate ${count} specific individuals (real people) who fit this category. Provide their full names and a brief explanation of their relevance:\n\nEvent: ${event_description}\n\nStakeholder category: ${query}`;
    
    try {
      const response = await query_perplexity_llm(prompt);
      return response.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
      console.error("Error generating individuals:", error);
      throw error;
    }
  };

  return await generate_individuals(3);
}

async function get_questions_for_individual(name, event_description) {
  const prompt = `Generate 3-5 specific questions to ask about ${name} in relation to the following event:\n\n${event_description}\n\nThese questions should help uncover key information about ${name}'s role, influence, or impact on the event. Focus on quantifiable aspects where possible.`;
  
  try {
    const response = await query_perplexity_llm(prompt);
    const questions = response.split('\n').filter(line => line.trim() !== '');
    return new IndividualQuestions(name, questions);
  } catch (error) {
    console.error("Error generating questions for individual:", error);
    throw error;
  }
}

app.get('/api/search_quotes', async (req, res) => {
  const search = req.query.search || '';
  const person = req.query.person || '';
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  try {
    const searchResults = await searchQuotes(search, person, page, pageSize);
    res.json(searchResults);
  } catch (error) {
    console.error('Error in /api/search_quotes:', error);
    res.status(500).json({ error: 'Internal server error', details: error.toString() });
  }
});


// Chat endpoint with market query processing and streaming
app.post('/api/chat', async (req, res) => {
  const { message, chatHistory } = req.body;
  console.log('=== Starting chat request processing ===');
  console.log('Received market query:', message);
  console.log('Chat history:', chatHistory);

  if (!message) {
    console.log('No message provided in request');
    return res.status(400).json({ error: 'Invalid query format' });
  }

  try {
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Load market data
    console.log('Fetching market data from cache/database...');
    const marketData = await getCachedMarketData(sql);
    console.log(`Loaded ${marketData.length} market records`);
    
    // Get structured queries
    console.log('Generating structured queries...');
    const queries = await getStructuredQuery(message);
    console.log('Generated queries:', queries);
    
    if (!queries || queries.length === 0) {
      console.log('No valid queries generated');
      throw new Error('Failed to structure the query');
    }

    // Process each query and collect results
    let allResults = [];
    for (const query of queries) {
      console.log('Processing query:', query);
      const results = await processMarketQuery(marketData, query);
      console.log(`Query returned ${results.length} results`);
      if (results.length > 0) {
        allResults = allResults.concat(results);
      }
    }
    console.log(`Total results after processing all queries: ${allResults.length}`);

    // Remove duplicates based on market ID
    const uniqueResults = Array.from(new Map(allResults.map(m => [m.id, m])).values());
    console.log(`Unique results after deduplication: ${uniqueResults.length}`);

    if (uniqueResults.length === 0) {
      console.log('No matching markets found');
      res.write(`data: ${JSON.stringify({ content: "No matching markets found for your query." })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Ensure uniqueResults is always an array and has required fields
    const validatedMarkets = Array.isArray(uniqueResults) ? uniqueResults.map(market => {
      const transformed = {
        id: market.id || market.market_id,
        question: market.question || '',
        yes_price: parseFloat(market.yes_price || market.final_best_ask || 0),
        no_price: parseFloat(market.no_price || (1 - market.final_best_bid) || 0),
        volume: parseFloat(market.volume || market.final_volume || 0),
        description: market.description || '',
        url: market.url || '',
        event_title: market.event_title || '',
        image: market.image || '/images/placeholder.png'
      };
      return transformed;
    }) : [];

    // Send validated market results first
    const marketMessage = {
      type: 'markets',
      markets: validatedMarkets,
      content: '',
      timestamp: Date.now()
    };

    res.write(`data: ${JSON.stringify(marketMessage)}\n\n`);

    // Set up a custom write stream to handle the synthesis output
    const streamWriter = new (require('stream').Writable)({
      write(chunk, encoding, callback) {
        const content = chunk.toString();
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
        callback();
      }
    });

    // Redirect stdout to our custom stream for synthesizeResults
    const oldWrite = process.stdout.write;
    process.stdout.write = streamWriter.write.bind(streamWriter);

    // Generate and stream the synthesis
    console.log('Starting synthesis of results...');
    await synthesizeResults(uniqueResults, message);
    console.log('Synthesis complete');

    // Restore stdout
    process.stdout.write = oldWrite;

    // End the stream
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    logger.error('Stream error:', error);
    // Only send error if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Chat stream error', 
        details: error.toString() 
      });
    } else {
      // Try to send error event if streaming has started
      res.write(`data: ${JSON.stringify({ error: error.toString() })}\n\n`);
      res.end();
    }
  }
});

app.use('/api/profile', profileRoutes);


app.get('/api/unique_tickers', async (req, res) => {
  const intervalMinutes = parseInt(req.query.interval) || 240;
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  // Add new filter parameter
  const openOnly = req.query.openOnly === 'true';

  console.log(`Received request for unique tickers with interval: ${intervalMinutes} minutes, search: ${search}, page: ${page}, pageSize: ${pageSize}, openOnly: ${openOnly}`);

  const cacheKey = `allUniqueTickers:${intervalMinutes}:${openOnly}:v8`;
  let allTickers = await getCachedData(cacheKey);

  if (!allTickers) {
    console.log(`Cache miss for ${cacheKey}, querying database directly`);
    const client = await pool.connect();
    try {
      const now = new Date();
      const pastDate = new Date(now.getTime() - intervalMinutes * 60 * 1000);

      console.log(`Query time range: Now: ${now.toISOString()}, Past Date: ${pastDate.toISOString()}`);

      const query = `
        WITH latest_prices AS (
          SELECT DISTINCT ON (market_id)
            market_id,
            last_traded_price AS final_last_traded_price,
            best_ask AS final_best_ask,
            best_bid AS final_best_bid,
            volume AS final_volume,
            timestamp AS final_timestamp
          FROM market_prices
          WHERE timestamp <= $1
          ORDER BY market_id, timestamp DESC
        ),
        initial_prices AS (
          SELECT DISTINCT ON (market_id)
            market_id,
            last_traded_price AS initial_last_traded_price,
            volume AS initial_volume,
            timestamp AS initial_timestamp
          FROM market_prices
          WHERE timestamp >= $2
          ORDER BY market_id, timestamp ASC
        )
        SELECT
          m.id as market_id,
          m.question,
          m.subtitle,
          m.yes_sub_title,
          m.no_sub_title,
          m.url,
          m.description,
          m.clobtokenids,
          m.outcomes,
          m.active,
          m.closed,
          m.archived,
          m.image,
          e.title as event_title,
          COALESCE(lp.final_last_traded_price, 0) as final_last_traded_price,
          COALESCE(lp.final_best_ask, 0) as final_best_ask,
          COALESCE(lp.final_best_bid, 0) as final_best_bid,
          COALESCE(lp.final_volume, 0) as final_volume,
          COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0) as initial_last_traded_price,
          COALESCE(ip.initial_volume, lp.final_volume, 0) as initial_volume,
          COALESCE(lp.final_last_traded_price, 0) - COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0) as price_change
        FROM 
          markets m
        JOIN
          events e ON m.event_id = e.id
        LEFT JOIN 
          latest_prices lp ON m.id = lp.market_id
        LEFT JOIN
          initial_prices ip ON m.id = ip.market_id
        WHERE 1=1
          ${openOnly ? 
			"AND (m.id LIKE '%-%' OR (m.active = true AND m.closed = false AND m.archived = false))" 
			: ''}
        ORDER BY 
          ABS(COALESCE(lp.final_last_traded_price, 0) - COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0)) DESC
      `;

      console.log('Executing database query...');
      const result = await client.query(query, [now, pastDate]);
      console.log(`Query returned ${result.rows.length} rows`);

      allTickers = result.rows.map(row => ({
        ...row,
        final_last_traded_price: parseFloat(row.final_last_traded_price) || 0,
        price_change: parseFloat(row.price_change) || 0,
        initial_last_traded_price: parseFloat(row.initial_last_traded_price) || 0,
        final_yes_price: parseFloat(row.final_yes_price),
        final_no_price: parseFloat(row.final_no_price),
        final_best_bid: parseFloat(row.final_best_bid) || 0,
        final_best_ask: parseFloat(row.final_best_ask) || 0,
        volume: parseFloat(row.final_volume) || 0,
        volume_change: parseFloat(row.volume_change) || 0,
        volume_change_percentage: parseFloat(row.volume_change_percentage) || 0,
        clobtokenids: row.clobtokenids || null,
        active: row.active,
        closed: row.closed,
        archived: row.archived,
        image: row.image && row.image !== '0' && row.image !== 'null' && row.image !== '' ? row.image : '/images/placeholder.png'
      }));

      // Sort by absolute price change, matching top movers
      allTickers.sort((a, b) => Math.abs(b.price_change) - Math.abs(a.price_change));

      await setCachedData(cacheKey, allTickers, 3600); // Cache for 1 hour
    } catch (error) {
      console.error('Error querying unique tickers:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    } finally {
      client.release();
    }
  }

  console.log(`Processing ${allTickers.length} tickers`);

  // Only apply search filter if there is a search term
  const filteredTickers = allTickers.filter(ticker => {
    if (search) {
      const searchTerms = search.toLowerCase().split(' ');
      const tickerText = (ticker.market_id + ' ' + ticker.question + ' ' + ticker.event_title).toLowerCase();
      return searchTerms.every(term => tickerText.includes(term));
    }
    return true;
  });

  console.log(`Filtered down to ${filteredTickers.length} tickers`);

  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedTickers = filteredTickers.slice(startIndex, endIndex);

  console.log(`Returning ${paginatedTickers.length} tickers for page ${page}`);

  try {
    const tickersWithDetails = await fetchAdditionalDetails(paginatedTickers);

    const tickersWithPrices = tickersWithDetails.map(ticker => ({
      ...ticker,
      yes_price: ticker.final_best_ask,
      no_price: 1 - ticker.final_best_bid,
      price_change_percent: ticker.initial_last_traded_price !== 0 
        ? (ticker.price_change / ticker.initial_last_traded_price) * 100 
        : 0,
      volume_change_percent: ticker.initial_volume !== 0
        ? (ticker.volume_change / ticker.initial_volume) * 100
        : 0,
      image: ticker.image || '/images/placeholder.png'
    }));

    const hasMore = endIndex < filteredTickers.length;

    res.json({
      tickers: tickersWithPrices,
      hasMore: hasMore
    });
  } catch (error) {
    console.error('Error fetching additional details for unique tickers:', error);
    res.status(500).json({ error: 'Error fetching additional details', details: error.message });
  }
});


app.post('/api/run-summary-script', async (req, res) => {
  const { marketId, clientId } = req.body;

  if (!marketId || !clientId) {
    return res.status(400).json({ error: 'marketId and clientId are required' });
  }

  const ws = clients.get(clientId);

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(400).json({ error: 'Invalid clientId or WebSocket not connected' });
  }

  console.log(`Received request to run summaryConvo.py for market ID: ${marketId} and client ID: ${clientId}`);

  try {
    const pythonProcess = spawn('python', ['summaryConvo.py', marketId]);

    // dataServer.js
pythonProcess.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (
        json.type === 'relevance_check' ||
        json.type === 'url_processing_start' ||
        json.type === 'url_processing_end' ||
        json.type === 'relevance_check_start' ||
        json.type === 'relevance_check_end'
      ) {
        // Forward these specific types directly
        ws.send(JSON.stringify({
          type: json.type,
          marketId,
          ...json 
        }));
      } else {
        // For summary messages, set type to 'summary_message' and include 'summaryType'
        ws.send(JSON.stringify({ 
          type: 'summary_message', 
          summaryType: json.type, // Add this line
          marketId, 
          content: json.content,
          side: json.side,
          message_order: json.message_order
        }));
      }
    } catch (err) {
      console.error('Error parsing JSON from summaryConvo.py stdout:', err, 'Data:', line);
    }
  }
});




    pythonProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      console.error(`summaryConvo.py error: ${errorMsg}`);
      ws.send(JSON.stringify({ type: 'summary_error', marketId, error: errorMsg }));
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`summaryConvo.py completed successfully for market ID: ${marketId}`);
        ws.send(JSON.stringify({ type: 'summary_complete', marketId }));
        res.json({ message: 'Summary script completed successfully' });
      } else {
        console.error(`summaryConvo.py exited with code ${code} for market ID: ${marketId}`);
        res.status(500).json({ error: 'Summary script failed', code });
      }
    });
  } catch (error) {
    console.error('Error running summaryConvo.py:', error);
    res.status(500).json({ error: 'Error running summary script', details: error.toString() });
  }
});




app.post('/api/run-getnewsfresh', async (req, res) => {
  const { topic, daysBack, numQueries, articlesPerQuery } = req.body;
  const outputFile = `news_results_${Date.now()}.json`;

  console.log('Received request to run getNewsFresh with params:', { topic, daysBack, numQueries, articlesPerQuery });

  const process = spawn('python', [
    'getNewsFresh.py',
    topic,
    daysBack.toString(),
    numQueries.toString(),
    articlesPerQuery.toString(),
    outputFile
  ]);

  let stdout = '';
  let stderr = '';

  process.stdout.on('data', (data) => {
    stdout += data.toString();
    console.log('getNewsFresh stdout:', data.toString());
  });

  process.stderr.on('data', (data) => {
    stderr += data.toString();
    console.error('getNewsFresh stderr:', data.toString());
  });

  process.on('close', (code) => {
    console.log(`getNewsFresh process exited with code ${code}`);
    if (code === 0) {
      res.json({ message: 'getNewsFresh completed successfully', outputFile, stdout, stderr });
    } else {
      res.status(500).json({ error: 'getNewsFresh process failed', code, stdout, stderr });
    }
  });
});

// Add these endpoints to your dataServer.js

// Fetch user's saved QA trees
app.get('/api/qa-trees', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const query = `
      SELECT 
        tree_id, 
        title, 
        description, 
        created_at
      FROM qa_trees 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching QA trees:', error);
    res.status(500).json({ error: 'Failed to fetch QA trees' });
  }
});

// Fetch specific QA tree details
app.get('/api/qa-tree/:treeId', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  const { treeId } = req.params;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Recursive CTE to fetch the entire tree structure
    const query = `
      WITH RECURSIVE tree_nodes AS (
        SELECT 
          node_id, 
          tree_id, 
          question, 
          answer, 
          NULL::uuid AS parent_node_id,
          0 AS depth
        FROM qa_nodes 
        WHERE tree_id = $1 AND node_id NOT IN (
          SELECT child_node_id 
          FROM qa_node_relationships 
          WHERE tree_id = $1
        )
        UNION ALL
        SELECT 
          n.node_id,
          n.tree_id,
          n.question,
          n.answer,
          r.parent_node_id,
          tn.depth + 1
        FROM qa_nodes n
        JOIN qa_node_relationships r ON n.node_id = r.child_node_id
        JOIN tree_nodes tn ON r.parent_node_id = tn.node_id
        WHERE n.tree_id = $1
      )
      SELECT 
        node_id,
        question,
        answer,
        parent_node_id,
        depth
      FROM tree_nodes
      ORDER BY depth, node_id
    `;
    
    const result = await pool.query(query, [treeId]);
    
    // Reconstruct the tree structure
    const nodeMap = new Map();
    const rootNodes = [];

    result.rows.forEach(node => {
      const treeNode = {
        id: node.node_id,
        question: node.question,
        answer: node.answer,
        children: []
      };
      nodeMap.set(node.node_id, treeNode);

      if (!node.parent_node_id) {
        rootNodes.push(treeNode);
      }
    });

    // Link children to parents
    result.rows.forEach(node => {
      if (node.parent_node_id) {
        const parentNode = nodeMap.get(node.parent_node_id);
        const currentNode = nodeMap.get(node.node_id);
        if (parentNode && currentNode) {
          parentNode.children.push(currentNode);
        }
      }
    });

    res.json(rootNodes[0]); // Assuming a single root node
  } catch (error) {
    console.error('Error fetching QA tree details:', error);
    res.status(500).json({ error: 'Failed to fetch QA tree details' });
  }
});

app.post('/api/save-qa-tree', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { marketId, treeData } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert the tree
    const treeResult = await client.query(
      'INSERT INTO qa_trees (user_id, market_id, title, description) VALUES ($1, $2, $3, $4) RETURNING tree_id',
      [
        userId, 
        marketId, 
        `Analysis Tree for ${marketId}`, 
        'User-generated QA Tree'
      ]
    );
    const treeId = treeResult.rows[0].tree_id;

    // Recursive function to insert nodes
    async function insertNode(node, parentNodeId = null) {
      const nodeResult = await client.query(
        'INSERT INTO qa_nodes (tree_id, question, answer, created_by) VALUES ($1, $2, $3, $4) RETURNING node_id',
        [treeId, node.question, node.answer, userId]
      );
      const nodeId = nodeResult.rows[0].node_id;

      // If there's a parent, create the relationship
      if (parentNodeId) {
        await client.query(
          'INSERT INTO qa_node_relationships (parent_node_id, child_node_id, tree_id) VALUES ($1, $2, $3)',
          [parentNodeId, nodeId, treeId]
        );
      }

      // Recursively insert child nodes
      if (node.subQuestions) {
        for (const childNode of node.subQuestions) {
          await insertNode(childNode, nodeId);
        }
      }

      return nodeId;
    }

    // Start inserting from the root
    await insertNode(treeData[0]);

    await client.query('COMMIT');
    res.json({ message: 'QA Tree saved successfully', treeId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving QA tree:', error);
    res.status(500).json({ error: 'Failed to save QA tree' });
  } finally {
    client.release();
  }
});

// Delete a QA tree
app.delete('/api/delete-qa-tree/:treeId', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  const { treeId } = req.params;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete node relationships
    await client.query('DELETE FROM qa_node_relationships WHERE tree_id = $1', [treeId]);
    
    // Delete nodes
    await client.query('DELETE FROM qa_nodes WHERE tree_id = $1', [treeId]);
    
    // Delete tree
    const result = await client.query(
      'DELETE FROM qa_trees WHERE tree_id = $1 AND user_id = $2 RETURNING *', 
      [treeId, userId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tree not found or unauthorized' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Tree deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting QA tree:', error);
    res.status(500).json({ error: 'Failed to delete tree' });
  } finally {
    client.release();
  }
});

// Update QA tree title
app.patch('/api/update-qa-tree-title/:treeId', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const userId = verifyToken(token);
  const { treeId } = req.params;
  const { title } = req.body;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await pool.query(
      'UPDATE qa_trees SET title = $1 WHERE tree_id = $2 AND user_id = $3 RETURNING *', 
      [title, treeId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tree not found or unauthorized' });
    }

    res.json({ message: 'Tree title updated successfully' });
  } catch (error) {
    console.error('Error updating QA tree title:', error);
    res.status(500).json({ error: 'Failed to update tree title' });
  }
});

app.get('/api/similar-markets/:marketId', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const { marketId } = req.params;
  const threshold = parseFloat(req.query.threshold) || 0.6;
  const interval = parseInt(req.query.interval) || 240; // Default to 4 hours if not specified

  if (!marketId) {
    return res.status(400).json({ error: 'Market ID is required' });
  }

  try {
    const cacheKey = `similar_markets:v4:${marketId}:${threshold}:${interval}`;
    let similarMarkets = await getCachedData(cacheKey);

    if (!similarMarkets) {
      const query = `
        WITH latest_prices AS (
          SELECT DISTINCT ON (market_id)
            market_id,
            last_traded_price as final_last_traded_price,
            best_ask as final_best_ask,
            best_bid as final_best_bid,
            volume as final_volume,
            timestamp as final_timestamp
          FROM market_prices
          WHERE timestamp <= NOW()
          ORDER BY market_id, timestamp DESC
        ),
        initial_prices AS (
          SELECT DISTINCT ON (market_id)
            market_id,
            CASE 
              WHEN market_id LIKE 'KX%' THEN best_ask  -- Use best_ask for Kalshi markets
              ELSE last_traded_price 
            END as initial_last_traded_price,
            volume as initial_volume,
            timestamp as initial_timestamp
          FROM market_prices
          WHERE timestamp >= NOW() - ($3 || ' minutes')::INTERVAL
          ORDER BY market_id, timestamp ASC
        ),
        source_market AS (
          SELECT 
            me.embedding,
            m.event_id,
            m.question,
            m.description,
            e.title as event_title
          FROM markets m
          JOIN market_embeddings me ON m.id = me.market_id
          JOIN events e ON m.event_id = e.id
          WHERE m.id = $1
        ),
        candidate_markets AS (
          SELECT 
            m.id,
            m.event_id,
            m.question,
            m.subtitle,
            m.yes_sub_title,
            m.no_sub_title,
            m.description,
            m.url,
            m.condid,
            m.slug,
            m.end_date,
            m.outcomes,
            m.group_item_title,
            m.open_time,
            m.close_time,
            m.status,
            m.clobtokenids,
            e.title as event_title,
            m.active,
            m.closed,
            m.archived,
            m.image,
            me.embedding,
            CASE 
              WHEN m.id LIKE 'KX%' THEN COALESCE(lp.final_best_ask, 0)  -- Use best_ask for Kalshi
              ELSE COALESCE(lp.final_last_traded_price, 0)  -- Use last_traded for others
            END as final_last_traded_price,
            lp.final_best_ask,
            lp.final_best_bid,
            lp.final_volume,
            CASE
              WHEN m.id LIKE 'KX%' THEN COALESCE(ip.initial_last_traded_price, lp.final_best_ask, 0)
              ELSE COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0)
            END as initial_last_traded_price,
            ip.initial_volume,
            CASE 
              WHEN m.id LIKE 'KX%' THEN 
                COALESCE(lp.final_best_ask, 0) - COALESCE(ip.initial_last_traded_price, lp.final_best_ask, 0)
              ELSE 
                COALESCE(lp.final_last_traded_price, 0) - COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0)
            END as price_change,
            1 - (me.embedding <=> (SELECT embedding FROM source_market)::vector) as embedding_similarity
          FROM markets m
          JOIN market_embeddings me ON m.id = me.market_id
          JOIN events e ON m.event_id = e.id
          LEFT JOIN latest_prices lp ON m.id = lp.market_id
          LEFT JOIN initial_prices ip ON m.id = ip.market_id
          WHERE m.id != $1
          AND (
            m.id LIKE '%-%-%' OR 
            (m.active = true AND m.closed = false AND m.archived = false)
          )
          AND m.description IS NOT NULL
        ),
        ranked_markets AS (
          SELECT 
            *,
            CASE 
              WHEN initial_volume = 0 THEN 
                CASE 
                  WHEN final_volume = 0 THEN 0
                  ELSE 100
                END
              ELSE ((final_volume - initial_volume) / initial_volume) * 100
            END AS volume_change_percentage,
            final_volume - initial_volume as volume_change
          FROM candidate_markets
          WHERE embedding_similarity >= $2
        )
        SELECT 
          id as market_id,
          event_id,
          question,
          subtitle,
          url,
          description,
          condid,
          slug,
          end_date,
          outcomes,
          group_item_title,
          open_time,
          close_time,
          status,
          clobtokenids,
          event_title,
          active,
          closed,
          archived,
          embedding_similarity as similarity_score,
          image,
          final_last_traded_price,
          final_best_ask,
          final_best_bid,
          final_volume,
          initial_last_traded_price,
          initial_volume,
          price_change,
          volume_change,
          volume_change_percentage
        FROM ranked_markets
        ORDER BY (embedding_similarity * 0.7 + COALESCE(ABS(price_change), 0) * 0.3) DESC
        LIMIT 50
      `;

      console.log(`Executing similar markets query for market ID: ${marketId}, threshold: ${threshold}, interval: ${interval}`);
      const result = await pool.query(query, [marketId, threshold, interval]);
      
      similarMarkets = result.rows.map(row => {
        const isKalshiMarket = row.market_id.startsWith('KX');
        const finalPrice = isKalshiMarket ? 
          parseFloat(row.final_best_ask) : 
          parseFloat(row.final_last_traded_price);
        const initialPrice = isKalshiMarket ? 
          parseFloat(row.initial_last_traded_price || row.final_best_ask) : 
          parseFloat(row.initial_last_traded_price || row.final_last_traded_price);
        
        const priceChange = finalPrice - initialPrice;
        const priceChangePercent = initialPrice !== 0 ? 
          (priceChange / initialPrice) * 100 : 
          0;

        return {
          market_id: row.market_id,
          event_id: row.event_id,
          question: row.question,
          subtitle: row.subtitle,
          url: row.url,
          description: row.description,
          description: row.description,
          condid: row.condid,
          slug: row.slug,
          end_date: row.end_date,
          outcomes: row.outcomes,
          group_item_title: row.group_item_title,
          open_time: row.open_time,
          close_time: row.close_time,
          status: row.status,
          clobtokenids: row.clobtokenids,
          event_title: row.event_title,
          active: row.active,
          closed: row.closed,
          archived: row.archived,
          similarity_score: parseFloat(row.similarity_score),
          final_last_traded_price: finalPrice,
          final_best_ask: parseFloat(row.final_best_ask) || 0,
          final_best_bid: parseFloat(row.final_best_bid) || 0,
          final_volume: parseFloat(row.final_volume) || 0,
          initial_last_traded_price: initialPrice,
          initial_volume: parseFloat(row.initial_volume) || 0,
          price_change: priceChange,
          volume_change: parseFloat(row.volume_change) || 0,
          volume_change_percentage: parseFloat(row.volume_change_percentage) || 0,
          // Additional metrics
          yes_price: parseFloat(row.final_best_ask) || 0,
          no_price: 1 - (parseFloat(row.final_best_bid) || 0),
          price_change_percent: priceChangePercent,
          image: row.image && row.image !== '0' && row.image !== 'null' && row.image !== '' ? 
            row.image : '/images/placeholder.png'
        };
      });

      // Additional filtering and validation
      similarMarkets = similarMarkets.filter(market => {
        // Ensure valid price data
        if (isNaN(market.price_change)) return false;
        
        // Different validation rules for different market types
        if (market.market_id.startsWith('KX')) {
          // Kalshi markets
          return market.final_best_ask >= 0 && market.final_best_ask <= 1;
        } else {
          // Regular markets
          return market.final_last_traded_price >= 0 && 
                 market.final_last_traded_price <= 1 &&
                 Math.abs(market.price_change) <= 1;
        }
      });

      // Cache for 5 minutes since this includes price data
      await setCachedData(cacheKey, similarMarkets, 300);
    }

    console.log(`Found ${similarMarkets.length} similar markets for market ID: ${marketId}`);
    res.json(similarMarkets);

  } catch (error) {
    console.error('Error finding similar markets:', error);
    res.status(500).json({ 
      error: 'Error finding similar markets', 
      details: error.toString() 
    });
  }
});

app.get('/api/final-analysis/:marketId/:chainId', async (req, res) => {
  const { marketId, chainId } = req.params;
  try {
    const query = 'SELECT analysis FROM final_analysis WHERE market_id = $1 AND chain_id = $2';
    console.log('Final analysis query:', query);
    console.log('Query parameters:', [marketId, chainId]);

    const result = await pool.query(query, [marketId, chainId]);
    console.log('Raw table results:', result.rows);

    if (result.rows.length > 0) {
      res.send(result.rows[0].analysis); // Send the analysis as plain text
    } else {
      res.status(404).send('No final analysis available for this chain ID');
    }
  } catch (error) {
    console.error('Error fetching final analysis:', error);
    res.status(500).send('Error fetching final analysis');
  }
});

app.post('/api/run-getkeyfigures', async (req, res) => {
  console.log('Received POST request to /api/run-getkeyfigures');
  const { description } = req.body;
  console.log(`Received run-getkeyfigures request for description: ${description}`);

  if (!description) {
    console.error('No description provided in the request body');
    return res.status(400).json({ error: 'No description provided' });
  }

  try {
    console.log(`Running getkeyfigures.py for description: ${description}`);
    const result = await runPythonScript('getkeyfigures.py', [description]);
    console.log('getkeyfigures.py completed successfully');
    console.log('Result:', result);
    
    // Parse the result and store it in the database
    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (parseError) {
      console.error('Error parsing result:', parseError);
      return res.status(500).json({ error: 'Error parsing result', details: parseError.toString() });
    }
    
    await storeKeyFigures(description, parsedResult);
    
    res.json({ result: parsedResult });
  } catch (error) {
    console.error('Error running getkeyfigures.py:', error);
    res.status(500).json({ error: 'Internal server error', details: error.toString() });
  }
});

async function storeKeyFigures(description, keyFigures) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertQuery = `
      INSERT INTO key_figures (description, figures)
      VALUES ($1, $2)
      ON CONFLICT (description) DO UPDATE
      SET figures = $2, updated_at = NOW()
    `;
    await client.query(insertQuery, [description, JSON.stringify(keyFigures)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error storing key figures:', error);
    throw error;
  } finally {
    client.release();
  }
}

const fs = require('fs').promises;
const path = require('path');

app.get('/api/related-markets/:marketId', async (req, res) => {
  const { marketId } = req.params;
  const interval = parseInt(req.query.interval) || 240; // Default to 4 hours if not specified
  
  try {
    // Try to get from cache first
    const cacheKey = `related_markets:${marketId}:${interval}`;
    const cachedMarkets = await getCachedData(cacheKey);
    
    if (cachedMarkets) {
      console.log(`Returning cached related markets for ${marketId}`);
      return res.json(cachedMarkets);
    }
    
    const client = await pool.connect();
    const query = `
      WITH market_event AS (
        SELECT event_id, question, description 
        FROM markets 
        WHERE id = $1
        AND event_id IS NOT NULL
      ),
      latest_prices AS (
        SELECT DISTINCT ON (market_id)
          market_id,
          last_traded_price as final_last_traded_price,
          best_ask as final_best_ask,
          best_bid as final_best_bid,
          volume as final_volume,
          timestamp as final_timestamp
        FROM market_prices
        WHERE timestamp <= NOW()
        ORDER BY market_id, timestamp DESC
      ),
      initial_prices AS (
        SELECT DISTINCT ON (market_id)
          market_id,
          CASE 
            WHEN market_id LIKE 'KX%' THEN best_ask
            ELSE last_traded_price 
          END as initial_last_traded_price,
          volume as initial_volume,
          timestamp as initial_timestamp
        FROM market_prices
        WHERE timestamp >= NOW() - ($2 || ' minutes')::INTERVAL
        ORDER BY market_id, timestamp ASC
      )
      SELECT 
        m.*,
        COALESCE(lp.final_last_traded_price, 0) as final_last_traded_price,
        COALESCE(lp.final_best_ask, 0) as final_best_ask,
        COALESCE(lp.final_best_bid, 0) as final_best_bid,
        COALESCE(lp.final_volume, 0) as final_volume,
        COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0) as initial_last_traded_price,
        COALESCE(ip.initial_volume, lp.final_volume, 0) as initial_volume,
        COALESCE(lp.final_last_traded_price, 0) - COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0) as price_change
      FROM markets m
      JOIN market_event me ON m.event_id = me.event_id
      LEFT JOIN latest_prices lp ON m.id = lp.market_id
      LEFT JOIN initial_prices ip ON m.id = ip.market_id
      WHERE m.id != $1
      AND (
        m.id LIKE 'KX%' OR 
        (m.active = true AND m.closed = false AND m.archived = false)
      )
      ORDER BY ABS(COALESCE(lp.final_last_traded_price, 0) - COALESCE(ip.initial_last_traded_price, lp.final_last_traded_price, 0)) DESC NULLS LAST
    `;
    
    console.log('Executing query for market ID:', marketId);
    const result = await client.query(query, [marketId, interval]);
    console.log(`Found ${result.rows.length} related markets`);
    
    if (result.rows.length === 0) {
      // Check if source market exists
      const marketCheck = await client.query('SELECT id, event_id FROM markets WHERE id = $1', [marketId]);
      if (marketCheck.rows.length === 0) {
        console.log('Source market not found');
        return res.status(404).json({ error: 'Market not found' });
      }
      console.log('Source market event_id:', marketCheck.rows[0].event_id);
      
      // Check for other markets in same event
      const eventCheck = await client.query(
        'SELECT COUNT(*) FROM markets WHERE event_id = $1',
        [marketCheck.rows[0].event_id]
      );
      console.log(`Found ${eventCheck.rows[0].count} markets in same event`);
    }
    
    // Cache the results for 5 minutes since this includes price data
    await setCachedData(cacheKey, result.rows, 300);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching related markets:', error);
    res.status(500).json({ error: 'Error fetching related markets' });
  }
});

app.post('/api/prediction-trade-ideas', async (req, res) => {
  console.log('Received POST request to /api/prediction-trade-ideas');
  const { query } = req.body;
  console.log(`Received prediction trade ideas request for query: ${query}`);

  if (!query) {
    console.error('No query provided in the request body');
    return res.status(400).json({ error: 'No query provided' });
  }

  try {
    const inputFile = path.join(__dirname, 'prediction_input.json');
    const outputFile = path.join(__dirname, 'prediction_output.json');

    await fs.writeFile(inputFile, JSON.stringify({ query }));

    console.log(`Running getPredictionTradeIdeas.py for query: ${query}`);
    
    // Send initial progress message
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'progress', message: 'Starting to gather news...' }));
      }
    });

    const pythonProcess = spawn('python', ['getPredictionTradeIdeas.py', inputFile, outputFile]);

    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (message.startsWith('PROGRESS:')) {
        // Broadcast progress to all connected WebSocket clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'progress', message: message.substring(9).trim() }));
          }
        });
      } else {
        console.log(`Python script output: ${message}`);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`Error from Python script: ${data}`);
    });

    await new Promise((resolve, reject) => {
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python script exited with code ${code}`));
        }
      });
    });

    console.log('getPredictionTradeIdeas.py completed successfully');

    const result = await fs.readFile(outputFile, 'utf-8');
    const parsedResult = JSON.parse(result);

    if (parsedResult.error) {
      console.error('Error from getPredictionTradeIdeas.py:', parsedResult.error);
      return res.status(400).json({ error: parsedResult.error });
    }

    res.json(parsedResult);

    // Clean up temporary files
    await fs.unlink(inputFile);
    await fs.unlink(outputFile);
  } catch (error) {
    console.error('Error in prediction trade ideas process:', error);
    res.status(500).json({ error: 'Internal server error', details: error.toString() });
  }
});

// Add cache clearing function
async function clearMoversCache() {
  try {
    const keys = await redis.keys('topMovers:*');
    if (keys.length > 0) {
      await redis.del(keys);
      console.log('Cleared top movers cache');
    }
  } catch (error) {
    console.error('Error clearing top movers cache:', error);
  }
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket Connection Established', new Date().toISOString());
  
  const clientId = uuidv4();
  clients.set(clientId, ws);
  
  // Track active streams for this connection
  const activeStreams = new Map();
  
  // Store userId if provided in connection
  let userId = null;
  
  // Send the clientId to the client
  ws.send(JSON.stringify({ 
    type: 'client_id', 
    clientId,
    timestamp: new Date().toISOString()
  }));
  
  ws.on('message', async (message) => {
    try {
      console.log('=== INCOMING WEBSOCKET MESSAGE ===');
      console.log('Raw Message:', message.toString());
      
      const data = JSON.parse(message.toString());
      
      console.log('Parsed Message:', JSON.stringify(data, null, 2));
      console.log('Message Type:', data.type);
      
      if (data.type === 'auth') {
        userId = data.userId;
        addUserSocket(userId, ws);
        console.log(`User ${userId} authenticated on WebSocket ${clientId}`);
      } else if (data.type === 'subscribe_orderbook') {
        console.log('=== ORDERBOOK SUBSCRIPTION REQUEST ===');
        const { marketId, side } = data;
        
        console.log('Subscription Details:', {
          marketId,
          side,
          timestamp: new Date().toISOString()
        });
        
        // Detailed market type logging
        const isKalshiMarket = marketId.includes('-');
        const isPolymarket = marketId.startsWith('0x');
        
        console.log('Market Type Identification:', {
          isKalshiMarket,
          isPolymarket,
          marketIdFormat: marketId
        });
        
        const streamKey = `${marketId}-${side}`;
        
        // Stop existing stream if any
        if (activeStreams.has(streamKey)) {
          console.log(`Stopping existing stream for ${streamKey}`);
          activeStreams.get(streamKey).stop();
        }
        
        // Determine stream class based on market type
        const isYes = side.toUpperCase() === 'YES';
        const StreamClass = isKalshiMarket ? KalshiStream : PolymarketStream;
        
        console.log('Stream Class Selection:', {
          selectedClass: StreamClass.name,
          isYes,
          side
        });
        
        // Pass sql as an additional parameter
        const stream = new StreamClass(marketId, isYes, ws, sql);
        
        // Enhanced initialization logging
        console.log('Attempting to Initialize Stream...');
        const initStartTime = Date.now();
        
        try {
          const initialized = await stream.initialize();
          
          const initDuration = Date.now() - initStartTime;
          console.log('Stream Initialization Result:', {
            success: initialized,
            durationMs: initDuration
          });
          
          if (initialized) {
            activeStreams.set(streamKey, stream);
            stream.connect();
            
            console.log('Stream Connected Successfully', {
              marketId,
              side,
              streamKey
            });
          } else {
            console.error('Stream Initialization Failed', {
              marketId,
              side,
              streamKey
            });
            
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to initialize orderbook stream',
              details: {
                marketId,
                side
              }
            }));
          }
        } catch (initError) {
          console.error('Stream Initialization Exception:', {
            error: initError.message,
            stack: initError.stack
          });
          
          ws.send(JSON.stringify({
            type: 'critical_error',
            message: 'Critical error during stream initialization',
            details: {
              errorMessage: initError.message
            }
          }));
        }
      } else if (data.type === 'unsubscribe_orderbook') {
        console.log('=== ORDERBOOK UNSUBSCRIPTION REQUEST ===');
        const { marketId, side } = data;
        const streamKey = `${marketId}-${side}`;
        
        if (activeStreams.has(streamKey)) {
          console.log(`Stopping and removing stream: ${streamKey}`);
          activeStreams.get(streamKey).stop();
          activeStreams.delete(streamKey);
        } else {
          console.log(`No active stream found for: ${streamKey}`);
        }
      } else {
        console.log('Unhandled Message Type:', data.type);
      }
    } catch (error) {
      console.error('WebSocket Message Processing Error:', {
        error: error.message,
        stack: error.stack,
        originalMessage: message.toString()
      });
      
      ws.send(JSON.stringify({
        type: 'processing_error',
        message: 'Error processing WebSocket message',
        details: {
          errorMessage: error.message
        }
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket Connection Closed', {
      clientId,
      userId,
      timestamp: new Date().toISOString()
    });
    
    if (userId) {
      removeUserSocket(userId, ws);
    }
    
    // Clean up all streams for this connection
    activeStreams.forEach(stream => {
      console.log('Stopping orphaned stream:', stream);
      stream.stop();
    });
    
    activeStreams.clear();
    clients.delete(clientId);
  });
});
function broadcastUpdate(data) {
  console.log('Broadcasting update:', JSON.stringify(data, null, 2));
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

server.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  updateTickerCache(); // Call updateTickerCache immediately when the server starts
});

setInterval(updateTickerCache, CACHE_UPDATE_INTERVAL);

module.exports = app; // If using for tests
async function getMarketInfo(marketId) {
  try {
    const result = await sql`
      SELECT * FROM markets WHERE id = ${marketId}
    `;
    if (result.length === 0) {
      console.log(`No market info found for market ID: ${marketId}`);
      return null;
    }
    return result[0];
  } catch (error) {
    console.error(`Error fetching market info for market ID ${marketId}:`, error);
    return null;
  }
}

async function getLastTradedPrice(marketId) {
  const result = await sql`
    SELECT last_traded_price
    FROM market_prices
    WHERE market_id = ${marketId}
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  return result[0]?.last_traded_price || null;
}
