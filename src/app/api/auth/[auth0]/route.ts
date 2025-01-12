import { getSession } from '@auth0/nextjs-auth0/edge';

export const runtime = 'edge';

export async function GET() {
  try {
    const session = await getSession();
    console.log('Session details:', {
      exists: !!session,
      hasUser: !!session?.user,
      hasToken: !!session?.accessToken,
      userId: session?.user?.sub
    });

    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!session.accessToken) {
      return new Response(JSON.stringify({ error: 'No access token found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      token: session.accessToken,
      userId: session.user.sub
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Token retrieval error:', error);
    const errorMessage = error instanceof Error 
      ? error.message 
      : String(error);

    return new Response(JSON.stringify({
      error: 'Failed to retrieve access token',
      details: errorMessage
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}