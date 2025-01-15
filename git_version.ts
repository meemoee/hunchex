import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import axios from 'axios';
import { db } from '@/app/db';
import { sql } from "drizzle-orm";

// Constants
const POLY_API_URL = 'https://clob.polymarket.com';
const KALSHI_API_BASE_URL = process.env.KALSHI_API_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_EMAIL = process.env.KALSHI_EMAIL;
const KALSHI_PASSWORD = process.env.KALSHI_PASSWORD;

// Type definitions
interface KalshiToken {
 token: string | null;
 userId: string | null;
 timestamp: number | null;
}

interface KalshiTokens {
 elections: KalshiToken;
}

interface MarketRow extends Record<string, unknown> {
  clobtokenids: string;
  condid: string;
  event_id: string;
}

interface KalshiCandle {
 end_period_ts: number;
 yes_ask: {
   close: string | number;
 };
}

interface PriceHistoryPoint {
 t: number;
 p: string | number;
}

// Kalshi auth state
const kalshiTokens: KalshiTokens = {
 elections: { token: null, userId: null, timestamp: null }
};

// Interval mapping configuration
const intervalMap = {
 '1d': { duration: 24 * 60 * 60, periodInterval: 1 },
 '1w': { duration: 7 * 24 * 60 * 60, periodInterval: 60 },
 '1m': { duration: 30 * 24 * 60 * 60, periodInterval: 60 },
 '3m': { duration: 90 * 24 * 60 * 60, periodInterval: 60 },
 '1y': { duration: 365 * 24 * 60 * 60, periodInterval: 1440 },
 '5y': { duration: 5 * 365 * 24 * 60 * 60, periodInterval: 1440 }
};

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

async function getKalshiMarketCandlesticks(seriesTicker: string, ticker: string, startTs: number, endTs: number, periodInterval: number) {
 const { userId, token } = kalshiTokens.elections;
 if (!userId || !token) {
   throw new Error('Kalshi authentication required');
 }
 
 try {
   const candlesticksResponse = await axios.get(
     `${KALSHI_API_BASE_URL}/series/${seriesTicker}/markets/${ticker}/candlesticks`, 
     {
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `${userId} ${token}`
       },
       params: {
         start_ts: startTs,
         end_ts: endTs,
         period_interval: periodInterval
       }
     }
   );
   
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

export async function GET(request: Request) {
 try {
   const { searchParams } = new URL(request.url);
   const marketId = searchParams.get('marketId');
   const interval = searchParams.get('interval') || '1d';

   if (!marketId) {
     return NextResponse.json(
       { error: 'Market ID is required' },
       { status: 400 }
     );
   }

   const endTs = Math.floor(Date.now() / 1000);
   const { duration, periodInterval } = intervalMap[interval as keyof typeof intervalMap] || intervalMap['1m'];
   const startTs = endTs - duration;

   // Get market info from database using parameterized query with sql template literal
   const results = await db.execute<MarketRow>(
	  sql`SELECT clobtokenids, condid, event_id FROM markets WHERE id = ${marketId}`
	).then(res => res.rows);
   
   // Check if we have any results
   if (!results || !Array.isArray(results) || results.length === 0) {
     return NextResponse.json(
       { error: 'Market not found' },
       { status: 404 }
     );
   }

   const { clobtokenids } = results[0] as MarketRow;
   let formattedData;

   const isKalshiMarket = marketId.includes('-') && !marketId.startsWith('0x');
   
   if (isKalshiMarket) {
     const seriesTicker = marketId.split('-')[0];
     await refreshKalshiAuth();
     
     const candlesticks = await getKalshiMarketCandlesticks(
       seriesTicker, 
       marketId, 
       startTs, 
       endTs, 
       periodInterval
     );

     formattedData = candlesticks.candlesticks.map((candle: KalshiCandle) => ({
        t: new Date(candle.end_period_ts * 1000).toISOString(),
        y: typeof candle.yes_ask.close === 'number' 
           ? candle.yes_ask.close / 100 
           : parseFloat(candle.yes_ask.close) / 100
      }));
   } else if (clobtokenids) {
     const parsedTokenIds = JSON.parse(clobtokenids);
     if (parsedTokenIds.length === 0) {
       return NextResponse.json(
         { error: 'No clobTokenIds found for this market' },
         { status: 400 }
       );
     }

     const response = await axios.get(`${POLY_API_URL}/prices-history`, {
       params: {
         market: parsedTokenIds[0],
         startTs: startTs,
         endTs: endTs,
         fidelity: periodInterval
       },
       headers: {
         'Authorization': 'Bearer 0x4929c395a0fd63d0eeb6f851e160642bb01975a808bf6119b07e52f3eca4ee69'
       }
     });

     formattedData = response.data.history.map((point: PriceHistoryPoint) => ({
       t: new Date(point.t * 1000).toISOString(),
       y: typeof point.p === 'string' ? parseFloat(point.p) : point.p
     }));
   } else {
     return NextResponse.json(
       { error: 'Invalid market type or missing data' },
       { status: 400 }
     );
   }

   return NextResponse.json(formattedData);

 } catch (error: unknown) {
   console.error('Error fetching price history:', error);
   return NextResponse.json(
     { 
       error: 'Error fetching price history',
       details: error instanceof Error ? error.message : 'Unknown error'
     },
     { status: 500 }
   );
 }
}