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

    // If no session, redirect to login instead of returning 401
    if (!session?.user) {
      debugInfo.stage = 'middleware-redirect-to-login';
      
      // Create the login URL with a return path
      const returnTo = encodeURIComponent(req.url);
      const loginUrl = `/api/auth/login?returnTo=${returnTo}`;
      
      const response = NextResponse.redirect(new URL(loginUrl, req.url));
      response.headers.set('x-auth-debug', JSON.stringify(debugInfo));
      return response;
    }

    // Add debug info to successful requests
    const next = NextResponse.next();
    next.headers.set('x-auth-debug', JSON.stringify(debugInfo));
    
    // Add user info to headers for downstream use if needed
    if (session.user.sub) {
      next.headers.set('x-auth-user-id', session.user.sub);
    }
    
    return next;

  } catch (error) {
    debugInfo.stage = 'middleware-error';
    debugInfo.error = error instanceof Error ? error.message : String(error);

    // For errors, redirect to login instead of returning error response
    const loginUrl = `/api/auth/login`;
    const response = NextResponse.redirect(new URL(loginUrl, req.url));
    response.headers.set('x-auth-debug', JSON.stringify(debugInfo));
    
    return response;
  }
}

// Export the middleware with auth required wrapper
export default withMiddlewareAuthRequired(middleware);