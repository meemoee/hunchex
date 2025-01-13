import { getSession } from '@auth0/nextjs-auth0/edge';
import { authLogger } from '../utils/authLogger';

export type AuthenticatedRequest = Request & {
  user?: {
    sub: string;
    email: string;
    permissions?: string[];
    [key: string]: string | number | boolean | null | string[] | undefined;
  };
};

type AuthHandler = (req: AuthenticatedRequest) => Promise<Response>;

export async function withAuth(handler: AuthHandler): Promise<(req: Request) => Promise<Response>> {
  return async (req: Request) => {
    const requestId = Math.random().toString(36).substring(7);
    authLogger.debug(`\n=== Auth Middleware START (${requestId}) ===`);
    
    try {
      // Log request details
      authLogger.debug('Request details:', {
        id: requestId,
        url: req.url,
        method: req.method,
        headers: Object.fromEntries(req.headers),
        cookies: req.headers.get('cookie'),
        ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        userAgent: req.headers.get('user-agent')
      });

      // Get Auth0 session using Edge-compatible method
      const session = await getSession();  // Remove req parameter for edge runtime
      
      if (!session?.user) {
        throw new Error('No authenticated user found');
      }

      // Create authenticated request with user info
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = {
        sub: session.user.sub,
        email: session.user.email as string,
        permissions: session.user.permissions as string[]
      };

      authLogger.debug(`[${requestId}] Auth successful, proceeding with handler`, {
        user: {
          sub: session.user.sub,
          email: session.user.email,
          permissions: session.user.permissions
        }
      });

      const result = await handler(authenticatedReq);
      
      authLogger.debug(`[${requestId}] Handler completed successfully`, {
        status: result.status,
        headers: Object.fromEntries(result.headers)
      });
      
      return result;

    } catch (err: unknown) {
      const errorDetails = err instanceof Error ? {
        name: err.name,
        message: err.message,
        stack: err.stack
      } : {
        name: 'UnknownError',
        message: 'An unknown error occurred'
      };

      authLogger.error(`[${requestId}] Auth middleware error:`, {
        error: errorDetails,
        request: {
          url: req.url,
          method: req.method,
          headers: Object.fromEntries(req.headers),
          ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
        }
      });

      return new Response(JSON.stringify({ 
        error: 'Authentication failed',
        message: errorDetails.message 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });

    } finally {
      authLogger.debug(`=== Auth Middleware END (${requestId}) ===\n`);
    }
  };
}
