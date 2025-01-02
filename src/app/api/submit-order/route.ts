import { getSession } from "@auth0/nextjs-auth0";
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { OrderService } from '@/services/OrderService';

// Initialize OrderService
const orderService = new OrderService();

export async function POST(request: NextRequest) {
  try {
    // Get Auth0 session
    const cookieStore = cookies();
    const session = await getSession({ cookies: () => cookieStore });
    
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { marketId, outcome, side, size, price } = await request.json();
    
    // Log for audit
    console.log('Order request:', {
      userId: session.user.sub,
      marketId,
      outcome,
      side,
      size,
      price,
      timestamp: new Date().toISOString()
    });

    const result = await orderService.submitOrder(session.user.sub, {
      marketId,
      outcome,
      side,
      size,
      price
    });

    return new Response(JSON.stringify({
      success: true,
      ...result
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Order submission error:', error);
    return new Response(JSON.stringify({
      error: 'Order submission failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}