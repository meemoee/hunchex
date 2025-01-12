import { getSession } from "@auth0/nextjs-auth0/edge";
import { db } from "@/app/db";
import { orders } from "@/app/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = 'edge';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const ordersToCancel = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, id),
          eq(orders.user_id, session.user.sub),
          eq(orders.status, 'active')
        )
      );

    if (ordersToCancel.length === 0) {
      return new Response(JSON.stringify({ error: "Order not found or already cancelled" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db
      .update(orders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.user_id, session.user.sub)
        )
      );

    const response = await fetch('/api/invalidate-holdings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.sub
      }
    });

    if (!response.ok) {
      console.error('Failed to invalidate holdings cache');
    }

    return new Response(JSON.stringify({ message: "Order cancelled successfully" }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    return new Response(JSON.stringify({ error: "Failed to cancel order" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}