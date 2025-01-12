import { getSession } from '@auth0/nextjs-auth0/edge';

export const runtime = 'edge';

export async function GET() {
  try {
    console.log('Starting auth check...');
    const session = await getSession();
    console.log('Auth debug info:', {
      sessionExists: !!session,
      hasUser: !!session?.user,
      hasToken: !!session?.accessToken,
      userId: session?.user?.sub,
      env: {
        hasBaseUrl: !!process.env.AUTH0_BASE_URL,
        hasIssuerBaseUrl: !!process.env.AUTH0_ISSUER_BASE_URL,
        baseUrl: process.env.AUTH0_BASE_URL,
        issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL
      }
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

    console.error('Detailed error information:', {
      error: errorMessage,
      type: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(JSON.stringify({
      error: 'Failed to retrieve access token',
      details: errorMessage
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}