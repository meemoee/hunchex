// src/app/api/holdings/route.ts
import { getSession } from "@auth0/nextjs-auth0/edge";
import { cookies } from "next/headers";
import { db } from "@/app/db";
import { holdings, markets, market_prices } from "@/app/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function GET() {
  const cookieStore = cookies();
  const session = await getSession({ cookies: () => cookieStore });

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const userHoldings = await db
      .select({
        id: holdings.id,
        user_id: holdings.user_id,
        market_id: holdings.market_id,
        token_id: holdings.token_id,
        position: holdings.position,
        outcome: holdings.outcome,
        amount: holdings.amount,
        entry_price: holdings.entry_price,
        created_at: holdings.created_at,
        question: markets.question,
        image: markets.image,
        current_price: sql`CASE 
          WHEN UPPER(${holdings.outcome}) = 'YES' THEN
              COALESCE(${market_prices.yes_price}, ${market_prices.best_ask}, ${market_prices.last_traded_price}, 0)
          WHEN UPPER(${holdings.outcome}) = 'NO' THEN
              COALESCE(${market_prices.no_price}, 1 - ${market_prices.best_bid}, 1 - ${market_prices.last_traded_price}, 0)
          ELSE
              COALESCE(${market_prices.last_traded_price}, ${market_prices.best_bid}, 0)
        END`,
        // Debug fields
        raw_yes_price: market_prices.yes_price,
        raw_no_price: market_prices.no_price,
        raw_best_ask: market_prices.best_ask,
        raw_best_bid: market_prices.best_bid,
        raw_last_traded: market_prices.last_traded_price,
        price_timestamp: market_prices.timestamp
      })
      .from(holdings)
      .leftJoin(markets, eq(holdings.market_id, markets.id))
      .leftJoin(
        market_prices,
        sql`${holdings.market_id} = ${market_prices.market_id} 
            AND ${market_prices.timestamp} >= NOW() - INTERVAL '24 hours'`
      )
      .where(eq(holdings.user_id, session.user.sub))
      .orderBy(desc(market_prices.timestamp));

    // Log debugging info
    console.log('Holdings query result:', JSON.stringify(userHoldings, null, 2));

    // Clean up debug fields before sending response
    const cleanHoldings = userHoldings.map(({ 
      raw_yes_price, raw_no_price, raw_best_ask, raw_best_bid, 
      raw_last_traded, price_timestamp, 
      ...holding 
    }) => holding);

    return Response.json(cleanHoldings);
  } catch (error) {
    console.error('Error fetching holdings:', error);
    return new Response(JSON.stringify({ 
      error: 'Error fetching holdings',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}