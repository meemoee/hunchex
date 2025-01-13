import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import type { NextRequest } from 'next/dist/server/web/spec-extension/request';
import { getSession } from '@auth0/nextjs-auth0/edge';

// Define types for our debug info structure
interface SessionAttemptInfo {
  exists: boolean;
  hasUser: boolean;
  userSub?: string;
  hasAccessToken: boolean;
  accessTokenLength: number;
  claims?: unknown;
  expiresAt?: number;
  scope?: string;
}

interface SessionErrorInfo {
  name: string;
  message: string;
  stack?: string;
  type: string;
}

interface DebugInfo {
  timestamp: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    cookies: { name: string; value: string }[];
    nextUrl: {
      pathname: string;
      searchParams: Record<string, string>;
      host: string;
      hostname: string;
      protocol: string;
    };
  };
  auth: {
    sessionAttempt: SessionAttemptInfo | null;
    sessionError: SessionErrorInfo | null;
    userPresent: boolean;
    tokenPresent: boolean;
  };
  environment: {
    AUTH0_BASE_URL?: string;
    AUTH0_ISSUER_BASE_URL?: string;
    VERCEL_URL?: string;
    NODE_ENV?: string;
  };
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};

export default async function middleware(req: NextRequest) {
  const debugInfo: DebugInfo = {
    timestamp: new Date().toISOString(),
    request: {
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      cookies: req.cookies.getAll(),
      nextUrl: {
        pathname: req.nextUrl.pathname,
        searchParams: Object.fromEntries(req.nextUrl.searchParams),
        host: req.nextUrl.host,
        hostname: req.nextUrl.hostname,
        protocol: req.nextUrl.protocol,
      }
    },
    auth: {
      sessionAttempt: null,
      sessionError: null,
      userPresent: false,
      tokenPresent: false,
    },
    environment: {
      AUTH0_BASE_URL: process.env.AUTH0_BASE_URL,
      AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL,
      VERCEL_URL: process.env.VERCEL_URL,
      NODE_ENV: process.env.NODE_ENV,
    }
  };

  try {
    if (req.nextUrl.pathname.startsWith('/_next') || 
        req.nextUrl.pathname.startsWith('/api/auth/')) {
      return NextResponse.next();
    }

    try {
      const session = await getSession();
      debugInfo.auth.sessionAttempt = {
        exists: !!session,
        hasUser: !!session?.user,
        userSub: session?.user?.sub,
        hasAccessToken: !!session?.accessToken,
        accessTokenLength: session?.accessToken ? session.accessToken.length : 0,
        claims: session?.accessTokenClaims,
        expiresAt: session?.accessTokenExpiresAt,
        scope: session?.accessTokenScope,
      };
      
      debugInfo.auth.userPresent = !!session?.user;
      debugInfo.auth.tokenPresent = !!session?.accessToken;

      if (!session?.user) {
        return new NextResponse(
          JSON.stringify({
            error: 'Not authenticated',
            debug: debugInfo
          }), {
            status: 401,
            headers: {
              'content-type': 'application/json',
              'x-debug-id': new Date().getTime().toString()
            }
          }
        );
      }

      return NextResponse.next();

    } catch (sessionError) {
      debugInfo.auth.sessionError = {
        name: sessionError instanceof Error ? sessionError.name : 'Unknown',
        message: sessionError instanceof Error ? sessionError.message : String(sessionError),
        stack: sessionError instanceof Error ? sessionError.stack : undefined,
        type: typeof sessionError
      };

      return new NextResponse(
        JSON.stringify({
          error: 'Session retrieval failed',
          debug: debugInfo
        }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'x-debug-id': new Date().getTime().toString()
          }
        }
      );
    }

  } catch (error) {
    return new NextResponse(
      JSON.stringify({
        error: 'Middleware error',
        details: error instanceof Error ? error.message : String(error),
        debug: {
          ...debugInfo,
          fatal_error: {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            type: typeof error
          }
        }
      }), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'x-debug-id': new Date().getTime().toString()
        }
      }
    );
  }
}