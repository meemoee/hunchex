import { cookies } from 'next/headers';
import { getSession } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  console.log('\n=== Next.js Order Submission START ===');
  const requestId = crypto.randomUUID();
  console.log(`Request ID: ${requestId}`);
  
  try {
    // Get session and validate authentication
    const cookieStore = cookies();
    const session = await getSession({ cookies: () => cookieStore });

    if (!session?.user) {
      console.log(`[${requestId}] Unauthorized request - no valid session`);
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized' }), 
        { status: 401 }
      );
    }

    // Parse order data
    const orderData = await request.json();
    console.log(`[${requestId}] Order data received:`, {
      marketId: orderData.marketId,
      tokenId: orderData.tokenId,
      orderType: orderData.orderType,
      side: orderData.side,
      size: orderData.size,
      price: orderData.price
    });

    // Forward to Express backend
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
      return new NextResponse(
        JSON.stringify(responseData),
        { status: response.status }
      );
    }

    // Enhance response with client-side guidance
    const enhancedResponse = {
      ...responseData,
      needsHoldingsRefresh: orderData.orderType === 'market' || responseData.immediateExecution,
      requestId,
      orderType: orderData.orderType
    };

    console.log(`[${requestId}] Order submission successful:`, {
      orderId: responseData.orderId,
      orderType: orderData.orderType,
      needsHoldingsRefresh: enhancedResponse.needsHoldingsRefresh
    });

    return NextResponse.json(enhancedResponse);
  } catch (error) {
    console.error(`[${requestId}] Order submission error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    });
    
    return new NextResponse(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        requestId 
      }),
      { status: 500 }
    );
  } finally {
    console.log(`[${requestId}] === Next.js Order Submission END ===\n`);
  }
}