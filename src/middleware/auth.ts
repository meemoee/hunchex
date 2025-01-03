import { NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { auth } from 'express-oauth2-jwt-bearer';

export const validateAuth0Token = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256',
  // Debug settings
  requestSigningAlgorithm: 'RS256',
  checkJwt: {
    rejectUnauthorized: false
  }
});

export async function withAuth(handler) {
  return async (req) => {
    console.log('\n=== Auth Middleware START ===');
    console.log('Request URL:', req.url);
    console.log('Headers:', Object.fromEntries(req.headers));
    console.log('Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
      AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL
    });

    try {
      console.log('Attempting to get session...');
      const session = await getSession(req);
      console.log('Session result:', {
        exists: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.sub
      });

      if (!session?.user) {
        console.log('No session or user found');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Validate JWT token
      try {
        console.log('Validating JWT token...');
        await validateAuth0Token(req);
        console.log('Token validation successful');
      } catch (error) {
        console.error('Token validation error:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }

      // Add user to request
      req.user = session.user;
      console.log('Auth successful, proceeding with handler');
      const result = await handler(req);
      console.log('Handler completed');
      return result;
    } catch (error) {
      console.error('Auth middleware error:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    } finally {
      console.log('=== Auth Middleware END ===\n');
    }
  };
}