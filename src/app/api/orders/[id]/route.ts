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
  console.log('DELETE request received for order:', params.id);
  
  const cookieStore = cookies();
  const session = await getSession({ cookies: () => cookieStore });

  console.log('Session user:', session?.user?.sub);

  if (!session?.user) {
    console.log('Unauthorized - No session user');
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    console.log('Checking if order exists...');
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

    console.log('Found orders:', ordersToCancel);

    if (ordersToCancel.length === 0) {
      console.log('No active orders found for cancellation');
      return NextResponse.json(
        { error: "Order not found or already cancelled" },
        { status: 404 }
      );
    }

    console.log('Attempting to cancel order...');

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
