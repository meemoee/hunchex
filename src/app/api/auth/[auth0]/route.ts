import { handleAuth, handleCallback } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import { Session } from '@auth0/nextjs-auth0';

export const runtime = 'edge';

export const GET = handleAuth({
  callback: handleCallback({
    async afterCallback(req: Request, session: Session) {
      // Create debug info
      const debugInfo = {
        stage: 'afterCallback',
        sessionExists: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.sub,
        timestamp: new Date().toISOString()
      };

      // Create response with debug info
      const response = NextResponse.json(session);
      
      // Add debug headers
      response.headers.set('x-auth-debug', JSON.stringify(debugInfo));
      response.headers.set('x-auth-stage', 'callback-complete');
      
      return session;
    }
  }),
  onError(req: Request, error: Error) {
    const debugInfo = {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    const response = NextResponse.json({ 
      error: 'Authentication error',
      message: error.message,
      debug: debugInfo
    }, { 
      status: 401 
    });

    response.headers.set('x-auth-debug', JSON.stringify(debugInfo));
    response.headers.set('x-auth-stage', 'error-handler');

    return response;
  }
});