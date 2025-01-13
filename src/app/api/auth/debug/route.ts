import { getSession } from '@auth0/nextjs-auth0/edge';

export const runtime = 'edge';

export async function GET() {
  try {
    console.log('Starting auth debug...');
    const session = await getSession();
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      session: {
        exists: !!session,
        hasUser: !!session?.user,
        hasToken: !!session?.accessToken,
        userId: session?.user?.sub,
        userEmail: session?.user?.email,
      },
      environment: {
        hasBaseUrl: !!process.env.AUTH0_BASE_URL,
        hasIssuerBaseUrl: !!process.env.AUTH0_ISSUER_BASE_URL,
        baseUrl: process.env.AUTH0_BASE_URL,
        issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL,
        vercelUrl: process.env.VERCEL_URL,
      }
    };

    return new Response(JSON.stringify(debugInfo, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return new Response(JSON.stringify({
      error: 'Debug error',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}