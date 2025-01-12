export async function GET() {
  return new Response(JSON.stringify({
    environment: {
      hasBaseUrl: !!process.env.AUTH0_BASE_URL,
      hasIssuerBaseUrl: !!process.env.AUTH0_ISSUER_BASE_URL,
      hasClientId: !!process.env.AUTH0_CLIENT_ID,
      hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
      hasSecret: !!process.env.AUTH0_SECRET,
      baseUrl: process.env.AUTH0_BASE_URL,
      issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL,
    },
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}