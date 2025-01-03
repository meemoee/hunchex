import { cookies } from 'next/headers';
import { getSession } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  console.log('\n=== Next.js Order Submission START ===');
  console.log('Request headers:', Object.fromEntries(request.headers));
  console.log('Request method:', request.method);
  
  try {
    console.log('Getting cookie store...');
    const cookieStore = await cookies();
    console.log('Cookie store retrieved:', cookieStore.getAll().map(c => ({ 
      name: c.name,
      path: c.path,
      secure: c.secure
    })));
    
    console.log('Getting Auth0 session...');
    const session = await getSession({
      req: {
        cookies: cookieStore
      } as any
    });
    console.log('Session result:', {
      exists: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.sub
    });

    if (!session?.user) {
      console.log('No authenticated user found');
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
    console.log('Order submission successful');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Order submission error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    });
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500 }
    );
  } finally {
    console.log('=== Next.js Order Submission END ===\n');
  }
}
