import { getSession } from "@auth0/nextjs-auth0/edge";
import { cookies } from "next/headers";
import { db } from "@/app/db";
import { orders, markets } from "@/app/db/schema";
import { and, eq, sql } from "drizzle-orm";

export async function GET(req: Request) {
  const cookieStore = cookies();
  const session = await getSession(req, { cookies: () => cookieStore });

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const activeOrders = await db
      .select({
        id: orders.id,
        user_id: orders.user_id,
        market_id: orders.market_id,
        token_id: orders.token_id,
        outcome: sql`UPPER(${orders.outcome})`,
        side: sql`UPPER(${orders.side})`,
        size: sql`CAST(${orders.size} AS TEXT)`,
        limit_price: sql`CAST(${orders.price} AS FLOAT)`,
        order_type: orders.order_type,
        status: orders.status,
        created_at: orders.created_at,
        question: markets.question,
        image: markets.image
      })
      .from(orders)
      .leftJoin(markets, eq(orders.market_id, markets.id))
      .where(
        and(
          eq(orders.user_id, session.user.sub),
          eq(orders.status, 'active')
        )
      );

    return Response.json(activeOrders);
  } catch (error) {
    console.error('Error fetching active orders:', error);
    return new Response(JSON.stringify({ 
      error: 'Error fetching active orders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}