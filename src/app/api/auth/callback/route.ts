import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import { getSession } from '@auth0/nextjs-auth0/edge';

export const runtime = 'edge';

export async function GET() {
  try {
    const session = await getSession();
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
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
    };

    return NextResponse.json(debugInfo);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}