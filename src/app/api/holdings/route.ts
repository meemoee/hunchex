// src/app/api/holdings/route.ts
import { getSession } from "@auth0/nextjs-auth0/edge";
import { cookies } from "next/headers";
import { db } from "@/app/db";
import { holdings, markets, market_prices } from "@/app/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";

export async function GET() {
  const cookieStore = cookies();
  const session = await getSession({ cookies: () => cookieStore });

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const userHoldings = await db.select({
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
              COALESCE(mp.yes_price, mp.best_ask, mp.last_traded_price, 0)
          WHEN UPPER(${holdings.outcome}) = 'NO' THEN
              COALESCE(mp.no_price, 1 - mp.best_bid, 1 - mp.last_traded_price, 0)
          ELSE
              COALESCE(mp.last_traded_price, mp.best_bid, 0)
        END`,
        // Debug fields
        raw_yes_price: sql`mp.yes_price`,
        raw_no_price: sql`mp.no_price`,
        raw_best_ask: sql`mp.best_ask`,
        raw_best_bid: sql`mp.best_bid`,
        raw_last_traded: sql`mp.last_traded_price`,
        price_timestamp: sql`mp.timestamp`
      })
      .from(sql`${holdings} h, ${markets} m,
        LATERAL (
          SELECT 
            market_id,
            yes_price,
            no_price,
            best_ask,
            best_bid,
            last_traded_price,
            timestamp
          FROM ${market_prices}
          WHERE market_id = h.market_id
          AND timestamp >= NOW() - INTERVAL '24 hours'
          ORDER BY timestamp DESC
          LIMIT 1
        ) mp`)
      .where(and(
        sql`h.market_id = m.id`,
        eq(sql`h.user_id`, session.user.sub)
      ))
      .orderBy(desc(sql`mp.timestamp`));

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
