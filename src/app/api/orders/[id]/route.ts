import { getSession } from "@auth0/nextjs-auth0/edge";
import { cookies } from "next/headers";
import { db } from "@/app/db";
import { orders } from "@/app/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies();
  const session = await getSession({ cookies: () => cookieStore });

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // First verify the order exists and belongs to the user
    const ordersToCancel = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, params.id),
          eq(orders.user_id, session.user.sub),
          eq(orders.status, 'active')
        )
      );

    if (ordersToCancel.length === 0) {
      return NextResponse.json(
        { error: "Order not found or already cancelled" },
        { status: 404 }
      );
    }

    // Update order status to cancelled
    await db
      .update(orders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(orders.id, params.id),
          eq(orders.user_id, session.user.sub)
        )
      );

    // Invalidate the active orders cache
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

    return NextResponse.json({ message: "Order cancelled successfully" });
  } catch (error) {
    console.error('Error cancelling order:', error);
    return NextResponse.json(
      { error: "Failed to cancel order" },
      { status: 500 }
    );
  }
}