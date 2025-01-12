import { getSession } from '@auth0/nextjs-auth0/edge';

export const runtime = 'edge';

export async function POST(request: Request) {
  console.log('\n=== Next.js Order Submission START ===');
  const requestId = crypto.randomUUID();
  console.log(`Request ID: ${requestId}`);
  
  try {
    const session = await getSession();

    if (!session?.user) {
      console.log(`[${requestId}] Unauthorized request - no valid session`);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const orderData = await request.json();
    console.log(`[${requestId}] Order data received:`, {
      marketId: orderData.marketId,
      tokenId: orderData.tokenId,
      orderType: orderData.orderType,
      side: orderData.side,
      size: orderData.size,
      price: orderData.price
    });

    const response = await fetch(`${process.env.EXPRESS_API_URL}/api/submit-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
        'x-user-id': session.user.sub,
        'x-request-id': requestId
      },
      body: JSON.stringify(orderData),
    });

    const responseData = await response.json();
    
    if (!response.ok) {
      console.error(`[${requestId}] Order submission failed:`, responseData);
      return new Response(JSON.stringify(responseData), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const enhancedResponse = {
      ...responseData,
      needsHoldingsRefresh: true,
      shouldRefreshOrders: true,
      requestId,
      orderType: orderData.orderType,
      orderDetails: {
        marketId: orderData.marketId,
        outcome: orderData.outcome,
        side: orderData.side,
        size: orderData.size,
        price: orderData.price,
        status: responseData.status || 'pending',
        timestamp: new Date().toISOString()
      }
    };

    console.log(`[${requestId}] Order submission successful:`, {
      orderId: responseData.orderId,
      orderType: orderData.orderType,
      marketId: orderData.marketId,
      side: orderData.side,
      size: orderData.size,
      needsHoldingsRefresh: true,
      shouldRefreshOrders: true
    });

    return new Response(JSON.stringify(enhancedResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    // Type-safe error logging
    console.error(`[${requestId}] Order submission error:`, {
      name: error instanceof Error ? error.name : 'Unknown Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error ? error.cause : undefined
    });
    
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error),
      requestId 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    console.log(`[${requestId}] === Next.js Order Submission END ===\n`);
  }
}