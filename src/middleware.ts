import { withMiddlewareAuthRequired } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import { getSession } from '@auth0/nextjs-auth0/edge';

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};

interface DebugInfo {
  stage: string;
  path: string;
  timestamp: string;
  hasSession?: boolean;
  hasUser?: boolean;
  error?: string;
}

async function middleware(req: Request) {
  const debugInfo: DebugInfo = {
    stage: 'middleware-start',
    path: req.url,
    timestamp: new Date().toISOString()
  };

  try {
    const session = await getSession();
    
    debugInfo.stage = 'middleware-after-session';
    debugInfo.hasSession = !!session;
    debugInfo.hasUser = !!session?.user;

    if (!session?.user) {
      const response = NextResponse.json({
        error: 'Not authenticated',
        debug: debugInfo
      }, {
        status: 401
      });

      response.headers.set('x-auth-debug', JSON.stringify(debugInfo));
      return response;
    }

    const next = NextResponse.next();
    next.headers.set('x-auth-debug', JSON.stringify(debugInfo));
    return next;

  } catch (error) {
    debugInfo.stage = 'middleware-error';
    debugInfo.error = error instanceof Error ? error.message : String(error);

    const response = NextResponse.json({
      error: 'Middleware error',
      debug: debugInfo
    }, {
      status: 500
    });

    response.headers.set('x-auth-debug', JSON.stringify(debugInfo));
    return response;
  }
}

export default withMiddlewareAuthRequired(middleware);