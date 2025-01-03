import { cookies } from 'next/headers';
import { getSession } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Properly await the cookieStore
    const cookieStore = await cookies();
    
    // Get session with properly typed cookie handler
    const session = await getSession({
      req: {
        cookies: cookieStore
      } as any
    });

    if (!session?.user) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized' }), 
        { status: 401 }
      );
    }

    // Extract order data from request
    const orderData = await request.json();
    
    // Forward request to Express backend with proper headers
    const response = await fetch(`${process.env.EXPRESS_API_URL}/api/submit-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
        'x-user-id': session.user.sub
      },
      body: JSON.stringify(orderData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return new NextResponse(
        JSON.stringify(errorData),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Route handler error:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    );
  }
}