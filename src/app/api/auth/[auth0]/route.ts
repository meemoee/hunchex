import { handleAuth, handleCallback } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import { Session } from '@auth0/nextjs-auth0';

export const runtime = 'edge';

export const GET = handleAuth({
  callback: handleCallback({
    afterCallback(req: Request, session: Session) {
      // Log successful authentication
      console.log('Auth callback completed', {
        sessionExists: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.sub
      });
      return session;
    }
  }),
  onError(req: Request, error: Error) {
    console.error('Auth error:', error);
    return NextResponse.json({ 
      error: 'Authentication error',
      message: error.message 
    }, { 
      status: 401 
    });
  }
});