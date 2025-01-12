import { auth } from 'express-oauth2-jwt-bearer';
import { authLogger } from '../utils/authLogger';

// Define types for our handler
type AuthenticatedRequest = Request & {
  user?: {
    sub: string;
    email: string;
    permissions?: string[];
    [key: string]: string | number | boolean | null | string[] | undefined;
  };
};

type AuthHandler = (req: AuthenticatedRequest) => Promise<Response>;

export const validateAuth0Token = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256'
});

export async function withAuth(handler: AuthHandler): Promise<(req: Request) => Promise<Response>> {
  return async (req: Request) => {
    const requestId = Math.random().toString(36).substring(7);
    authLogger.debug(`\n=== Auth Middleware START (${requestId}) ===`);
    authLogger.debug('Request details:', {
      id: requestId,
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      cookies: req.headers.get('cookie'),
      ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      userAgent: req.headers.get('user-agent')
    });
    authLogger.debug('Environment configuration:', {
      id: requestId,
      NODE_ENV: process.env.NODE_ENV,
      AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
      AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL,
      isProduction: process.env.NODE_ENV === 'production'
    });

    try {
      authLogger.debug(`[${requestId}] Validating JWT token...`);
      await validateAuth0Token(req);
      
      // Extract user information from the JWT token
      const authHeader = req.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token) {
        throw new Error('No token provided');
      }

      // Decode the JWT to get user information
      const [, payload] = token.split('.');
      const decodedUser = JSON.parse(atob(payload));

      // Add user to request and cast to AuthenticatedRequest
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = {
        sub: decodedUser.sub,
        email: decodedUser.email,
        permissions: decodedUser.permissions
      };

      authLogger.debug(`[${requestId}] Auth successful, proceeding with handler`, {
        user: {
          sub: decodedUser.sub,
          email: decodedUser.email,
          permissions: decodedUser.permissions
        }
      });

      const result = await handler(authenticatedReq);
      authLogger.debug(`[${requestId}] Handler completed successfully`, {
        status: result.status,
        headers: Object.fromEntries(result.headers)
      });
      return result;

    } catch (err: unknown) {
      // Type guard function for Error with optional code property
      const isErrorWithCode = (error: unknown): error is Error & { code?: string } => {
        return error instanceof Error;
      };

      const errorDetails = isErrorWithCode(err) ? {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: err.code
      } : {
        name: 'UnknownError',
        message: 'An unknown error occurred',
        stack: undefined,
        code: undefined
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
      
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });

    } finally {
      authLogger.debug(`=== Auth Middleware END (${requestId}) ===\n`);
    }
  };
}