import { db } from '@/app/db';  // Adjust the import path as needed

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const isAdmin = authHeader === process.env.DEBUG_ADMIN_TOKEN;

  // Helper functions defined within the scope where they're used
  async function testDatabaseConnection() {
    try {
      // Try a simple query - adjust this based on your actual db schema
      await db.query.qa_trees.findFirst();  // assuming you have a qa_trees table
      return { 
        status: 'connected',
        details: 'Successfully executed test query'
      };
    } catch (error) {
      return { 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Unknown database error',
        details: error instanceof Error ? error.stack : undefined
      };
    }
  }

  async function testAuth0Connection() {
    try {
      const response = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/.well-known/openid-configuration`);
      if (!response.ok) {
        throw new Error(`Auth0 connection failed: ${response.statusText}`);
      }
      return { 
        status: 'connected',
        details: 'Successfully verified Auth0 configuration endpoint'
      };
    } catch (error) {
      return { 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Unknown Auth0 error',
        details: error instanceof Error ? error.stack : undefined
      };
    }
  }

  try {
    const debugInfo = {
      environment: {
        variables: Object.keys(process.env).filter(key => 
          key.startsWith('AUTH0_') || 
          key.startsWith('NEXT_') || 
          key.startsWith('VERCEL_')
        ),
        auth0: {
          hasBaseUrl: !!process.env.AUTH0_BASE_URL,
          hasIssuerBaseUrl: !!process.env.AUTH0_ISSUER_BASE_URL,
          hasClientId: !!process.env.AUTH0_CLIENT_ID,
          hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
          hasSecret: !!process.env.AUTH0_SECRET,
          ...(isAdmin && {
            baseUrl: process.env.AUTH0_BASE_URL,
            issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL,
          })
        },
        runtime: {
          nodeEnv: process.env.NODE_ENV,
          nodeVersion: process.version,
          platform: process.platform,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          memory: process.memoryUsage(),
        }
      },
      connections: {
        database: await testDatabaseConnection(),
        auth0: await testAuth0Connection(),
      },
      build: {
        timestamp: new Date().toISOString(),
        vercelEnv: process.env.VERCEL_ENV || 'local',
        deploymentUrl: process.env.VERCEL_URL || 'localhost',
      }
    };

    return new Response(JSON.stringify(debugInfo, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'An unknown error occurred';
    
    const errorStack = error instanceof Error 
      ? error.stack 
      : undefined;

    return new Response(JSON.stringify({
      error: {
        message: errorMessage,
        stack: isAdmin ? errorStack : undefined,
        timestamp: new Date().toISOString()
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}