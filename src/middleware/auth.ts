import { NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { auth } from 'express-oauth2-jwt-bearer';
import { authLogger } from '../utils/authLogger';

export const validateAuth0Token = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256',
  // Debug settings
  requestSigningAlgorithm: 'RS256',
  checkJwt: {
    rejectUnauthorized: false
  },
  // Add error handler for token validation
  errorHandler: (err, req, res) => {
    authLogger.error('Token validation error:', {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: err.code,
        statusCode: err.statusCode
      },
      request: {
        url: req.url,
        method: req.method,
        headers: req.headers,
        ip: req.ip
      },
      auth: {
        audience: process.env.AUTH0_AUDIENCE,
        issuer: process.env.AUTH0_ISSUER_BASE_URL
      }
    });
    throw err;
  }
});

export async function withAuth(handler) {
  return async (req) => {
    const requestId = Math.random().toString(36).substring(7);
    authLogger.debug(`\n=== Auth Middleware START (${requestId}) ===`);
    authLogger.debug('Request details:', {
      id: requestId,
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers),
      cookies: req.cookies,
      ip: req.ip,
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
      authLogger.debug(`[${requestId}] Attempting to get session...`);
      const session = await getSession(req);
      authLogger.debug(`[${requestId}] Session details:`, {
        exists: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.sub,
        userEmail: session?.user?.email,
        lastRefresh: session?.refreshedAt,
        expiresAt: session?.expiresAt,
        scope: session?.scope,
        permissions: session?.user?.permissions
      });

      if (!session?.user) {
        authLogger.error(`[${requestId}] Authentication failed: No valid session or user found`);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Validate JWT token
      try {
        authLogger.debug(`[${requestId}] Validating JWT token...`);
        await validateAuth0Token(req);
        authLogger.debug(`[${requestId}] Token validation successful`, {
          user: {
            sub: session.user.sub,
            email: session.user.email,
            permissions: session.user.permissions
          },
          tokenInfo: {
            iss: session.user.iss,
            aud: process.env.AUTH0_AUDIENCE,
            exp: session.expiresAt
          }
        });
      } catch (error) {
        authLogger.error(`[${requestId}] Token validation error:`, {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code
          },
          session: {
            exists: !!session,
            hasUser: !!session?.user,
            userId: session?.user?.sub
          },
          request: {
            url: req.url,
            method: req.method,
            headers: Object.fromEntries(req.headers)
          }
        });
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }

      // Add user to request
      req.user = session.user;
      authLogger.debug(`[${requestId}] Auth successful, proceeding with handler`);
      const result = await handler(req);
      authLogger.debug(`[${requestId}] Handler completed successfully`, {
        status: result.status,
        headers: Object.fromEntries(result.headers)
      });
      return result;
    } catch (error) {
      authLogger.error(`[${requestId}] Auth middleware error:`, {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code
        },
        request: {
          url: req.url,
          method: req.method,
          headers: Object.fromEntries(req.headers),
          ip: req.ip
        },
        session: session ? {
          exists: true,
          hasUser: !!session?.user,
          userId: session?.user?.sub
        } : {
          exists: false
        }
      });
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    } finally {
      authLogger.debug(`=== Auth Middleware END (${requestId}) ===\n`);
    }
  };
}
