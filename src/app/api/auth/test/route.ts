interface RequestInfo {
  headers: Record<string, string>;
  url: string;
  cookies: string | null;
}

interface ConfigInfo {
  baseUrl?: string;
  frontendUrl?: string;
  vercelUrl?: string;
  issuerUrl?: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasSecret: boolean;
}

interface TestResults {
  timestamp: string;
  request: RequestInfo;
  config?: ConfigInfo;
  error?: {
    message: string;
    stack?: string;
  };
}

export const runtime = 'edge';

export async function GET(request: Request) {
  const results: TestResults = {
    timestamp: new Date().toISOString(),
    request: {
      headers: Object.fromEntries(request.headers),
      url: request.url,
      cookies: request.headers.get('cookie')
    },
    config: {
      baseUrl: process.env.AUTH0_BASE_URL || process.env.VERCEL_URL,
      frontendUrl: process.env.FRONTEND_URL,
      vercelUrl: process.env.VERCEL_URL,
      issuerUrl: process.env.AUTH0_ISSUER_BASE_URL,
      hasClientId: !!process.env.AUTH0_CLIENT_ID,
      hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
      hasSecret: !!process.env.AUTH0_SECRET
    }
  };

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}