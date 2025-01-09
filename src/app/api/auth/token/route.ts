import { getSession } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    console.log('Session details:', {
      exists: !!session,
      hasUser: !!session?.user,
      hasToken: !!session?.accessToken,
      userId: session?.user?.sub
    });

    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!session.accessToken) {
      return NextResponse.json({ error: 'No access token found' }, { status: 401 });
    }

    return NextResponse.json({
      token: session.accessToken,
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
