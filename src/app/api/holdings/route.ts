import { getSession } from "@auth0/nextjs-auth0/edge";
import { cookies } from "next/headers";
import { db } from "@/app/db";
import { holdings, markets } from "@/app/db/schema";
import { and, eq, sql } from "drizzle-orm";

export async function GET() {
  const cookieStore = cookies();
  const session = await getSession({ cookies: () => cookieStore });

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Direct database query similar to active orders
    const userHoldings = await db
      .select({
        id: holdings.id,
        user_id: holdings.user_id,
        market_id: holdings.market_id,
        token_id: holdings.token_id,
        outcome: sql`UPPER(${holdings.outcome})`,
        position: holdings.position,
        amount: sql`CAST(${holdings.amount} AS TEXT)`,
        entry_price: sql`CAST(${holdings.entry_price} AS TEXT)`,
        created_at: holdings.created_at,
        question: markets.question,
        image: markets.image,
        // Add any price calculations needed for current_price
        current_price: sql`COALESCE((
          SELECT CAST(best_ask AS TEXT)
          FROM market_prices
          WHERE market_id = ${holdings.market_id}
          ORDER BY timestamp DESC
          LIMIT 1
        ), '0')`
      })
      .from(holdings)
      .leftJoin(markets, eq(holdings.market_id, markets.id))
      .where(eq(holdings.user_id, session.user.sub));

    console.log('Holdings query result:', JSON.stringify(userHoldings, null, 2));

    return Response.json(userHoldings);
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