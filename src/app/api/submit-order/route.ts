import { getSession } from "@auth0/nextjs-auth0";
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

if (!process.env.EXPRESS_API_URL) {
  throw new Error('EXPRESS_API_URL environment variable is not set');
}

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

    const orderData = await request.json();
    
    // Log for audit
    console.log('Order request:', {
      userId: session.user.sub,
      ...orderData,
      timestamp: new Date().toISOString()
    });

    // Forward request to Express backend
    const response = await fetch(`${process.env.EXPRESS_API_URL}/api/submit-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
        'X-User-ID': session.user.sub
      },
      body: JSON.stringify(orderData)
    });

    const data = await response.json();

    // Forward Express response status and data
    return new Response(JSON.stringify(data), {
      status: response.status,
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
