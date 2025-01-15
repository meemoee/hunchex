const axios = require('axios');

// Kalshi auth state
let kalshiTokens = {
  elections: { token: null, userId: null, timestamp: null }
};

// Constants
const POLY_API_URL = 'https://clob.polymarket.com';
const KALSHI_API_BASE_URL = process.env.KALSHI_API_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_EMAIL = process.env.KALSHI_EMAIL;
const KALSHI_PASSWORD = process.env.KALSHI_PASSWORD;


// Interval mapping configuration
const intervalMap = {
  '1d': { duration: 24 * 60 * 60, periodInterval: 1 },
  '1w': { duration: 7 * 24 * 60 * 60, periodInterval: 60 },
  '1m': { duration: 30 * 24 * 60 * 60, periodInterval: 60 },
  '3m': { duration: 90 * 24 * 60 * 60, periodInterval: 60 },
  '1y': { duration: 365 * 24 * 60 * 60, periodInterval: 1440 },
  '5y': { duration: 5 * 365 * 24 * 60 * 60, periodInterval: 1440 }
};

// Kalshi market candlesticks fetcher
async function getKalshiMarketCandlesticks(seriesTicker, ticker, startTs, endTs, periodInterval) {
  const { userId, token } = kalshiTokens.elections;
  if (!userId || !token) {
    throw new Error('Kalshi authentication required');
  }
  const candlesticksUrl = `${process.env.KALSHI_API_BASE_URL}/series/${seriesTicker}/markets/${ticker}/candlesticks`;
  
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
    
    throw new Error(`No candlesticks data returned from ${process.env.KALSHI_API_BASE_URL}`);
  } catch (error) {
    console.error(`Error fetching candlesticks from ${process.env.KALSHI_API_BASE_URL}:`, error);
    throw error;
  }
}

// Main price history fetcher
async function fetchPriceHistory(marketId, interval, sql, getCachedData, setCachedData) {
  const endTs = Math.floor(Date.now() / 1000);
  const { duration, periodInterval } = intervalMap[interval] || intervalMap['1m'];
  const startTs = endTs - duration;

  try {
    const result = await sql`SELECT clobtokenids, condid, event_id FROM markets WHERE id = ${marketId}`;
    
    if (!result || result.length === 0) {
      throw new Error('Market not found');
    }

    const { clobtokenids, condid, event_id } = result[0];
    let formattedData;

    const isKalshiMarket = marketId.includes('-') && !marketId.startsWith('0x');
    
    if (isKalshiMarket) {
      const seriesTicker = marketId.split('-')[0];
      // Ensure we have valid auth tokens
      await refreshKalshiAuth();
      
      const candlesticks = await getKalshiMarketCandlesticks(
        seriesTicker, 
        marketId, 
        startTs, 
        endTs, 
        periodInterval
      );

      formattedData = candlesticks.candlesticks.map(candle => ({
        t: new Date(candle.end_period_ts * 1000).toISOString(),
        y: parseFloat(candle.yes_ask.close) / 100
      }));
    } else if (clobtokenids) {
      const clobTokenIds = JSON.parse(clobtokenids);
      if (clobTokenIds.length === 0) {
        throw new Error('No clobTokenIds found for this market');
      }

      const response = await axios.get(`${POLY_API_URL}/prices-history`, {
        params: {
          market: clobTokenIds[0],
          startTs: startTs,
          endTs: endTs,
          fidelity: periodInterval
        },
        headers: {
          'Authorization': 'Bearer 0x4929c395a0fd63d0eeb6f851e160642bb01975a808bf6119b07e52f3eca4ee69'
        }
      });

      formattedData = response.data.history.map(point => ({
        t: new Date(point.t * 1000).toISOString(),
        y: parseFloat(point.p)
      }));
    } else {
      throw new Error('Invalid market type or missing data');
    }

    return formattedData;
  } catch (error) {
    console.error('Error fetching price history:', error);
    throw error;
  }
}

// Kalshi authentication functions
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

async function refreshKalshiAuth() {
  if (!kalshiTokens.elections.token || 
      !kalshiTokens.elections.timestamp || 
      Date.now() - kalshiTokens.elections.timestamp > 55 * 60 * 1000) {
    await authenticateKalshiElections();
  }
  return kalshiTokens.elections;
}

module.exports = {
  intervalMap,
  getKalshiMarketCandlesticks,
  fetchPriceHistory,
  refreshKalshiAuth
};
