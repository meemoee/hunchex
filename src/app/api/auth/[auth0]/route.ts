import { handleAuth } from '@auth0/nextjs-auth0/edge';
import { NextResponse } from 'next/dist/server/web/spec-extension/response';

export const runtime = 'edge';

// Simple handler for edge runtime
export const GET = handleAuth();

// Move debug routes to a separate endpoint
export async function POST() {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    env: {
      hasBaseUrl: !!process.env.AUTH0_BASE_URL,
      hasIssuerBaseUrl: !!process.env.AUTH0_ISSUER_BASE_URL,
      baseUrl: process.env.AUTH0_BASE_URL,
      issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL
    }
  };

  return NextResponse.json(debugInfo);
}