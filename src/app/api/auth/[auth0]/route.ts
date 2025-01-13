import { handleAuth, handleCallback } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import { Session } from '@auth0/nextjs-auth0';

export const runtime = 'edge';

export const GET = handleAuth({
  callback: handleCallback({
    async afterCallback(req: Request, session: Session) {
      console.log('Starting afterCallback...', {
        url: req.url,
        hasSession: !!session,
        headers: Object.fromEntries(req.headers),
        cookies: req.headers.get('cookie')
      });

      if (!session) {
        console.error('No session created in afterCallback');
        throw new Error('Failed to create session');
      }

      console.log('Auth callback completed', {
        sessionExists: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.sub,
        tokenExpiry: session?.accessTokenExpiresAt,
        env: {
          baseUrl: process.env.AUTH0_BASE_URL,
          issuerUrl: process.env.AUTH0_ISSUER_BASE_URL
        }
      });

      return session;
    }
  }),
  onError(req: Request, error: Error) {
    console.error('Auth error:', {
      error: error.message,
      stack: error.stack,
      url: req.url,
      headers: Object.fromEntries(req.headers)
    });

    return NextResponse.json({ 
      error: 'Authentication error',
      message: error.message,
      timestamp: new Date().toISOString()
    }, { 
      status: 401 
    });
  }
});