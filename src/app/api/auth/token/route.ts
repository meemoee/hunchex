import { getSession } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    // Use async cookies() method
    const cookieStore = await cookies();
    
    // Get the session using the edge runtime method
    const session = await getSession({ cookies: () => cookieStore });

    // Check if user is authenticated
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Return the access token
    return NextResponse.json({ 
      accessToken: session.accessToken,
      userId: session.user.sub
    });

  } catch (error) {
    console.error('Token retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve access token', details: error.toString() }, 
      { status: 500 }
    );
  }
}