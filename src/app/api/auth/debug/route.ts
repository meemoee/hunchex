import { db } from '@/app/db';
import { redis } from '@/app/db/redis';
import { sql } from 'drizzle-orm';
import * as schema from '@/app/db/schema';

export async function GET() {
  // Test specific database tables
  async function testDatabaseTables() {
    const results: Record<string, { status: string; error?: string }> = {};
    
    try {
      // Test each table individually
      const tables = [
        { name: 'qa_trees', schema: schema.qa_trees },
        { name: 'users', schema: schema.users },
        { name: 'holdings', schema: schema.holdings },
        { name: 'orders', schema: schema.orders },
        { name: 'markets', schema: schema.markets },
        { name: 'market_prices', schema: schema.market_prices }
      ];

      for (const table of tables) {
        try {
          await db.select({ count: sql`count(*)` }).from(table.schema);
          results[table.name] = { status: 'ok' };
        } catch (error) {
          results[table.name] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
  }

  // Test Redis operations
  async function testRedisOperations() {
    const results: Record<string, { status: string; error?: string }> = {};
    
    try {
      // Test basic connection
      try {
        await redis.ping();
        results.connection = { status: 'ok' };
      } catch (error) {
        results.connection = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }

      // Test write operation
      try {
        await redis.set('debug_test', 'test');
        await redis.get('debug_test');
        await redis.del('debug_test');
        results.operations = { status: 'ok' };
      } catch (error) {
        results.operations = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
  }

  // Test Auth0 endpoints
  async function testAuth0Endpoints() {
    const results: Record<string, { status: string; error?: string }> = {};
    
    try {
      // Test endpoints
      const endpoints = [
        '.well-known/openid-configuration',
        'userinfo',
        'oauth/token'
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/${endpoint}`);
          results[endpoint] = { 
            status: response.ok ? 'ok' : 'error',
            error: !response.ok ? `HTTP ${response.status}` : undefined
          };
        } catch (error) {
          results[endpoint] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
  }

  // Test API routes
  async function testAPIRoutes() {
    const results: Record<string, { status: string; error?: string }> = {};
    
    try {
      const routes = [
        '/api/auth/token',
        '/api/auth/debug',
        '/api/holdings',
        '/api/orders',
        '/api/qa-trees',
        '/api/balance',
        '/api/active-orders',
        '/api/markets'
      ];

      for (const route of routes) {
        try {
          const response = await fetch(`${process.env.AUTH0_BASE_URL}${route}`);
          results[route] = { 
            status: response.ok ? 'ok' : 'error',
            error: !response.ok ? `HTTP ${response.status}` : undefined
          };
        } catch (error) {
          results[route] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
  }

  // Test environment variables
  function testEnvironmentVariables() {
    const required = [
      'AUTH0_ISSUER_BASE_URL',
      'AUTH0_CLIENT_ID',
      'AUTH0_CLIENT_SECRET',
      'AUTH0_SECRET',
      'DATABASE_URL',
      'REDIS_URL'
    ];

    return Object.fromEntries(
      required.map(key => [
        key,
        { 
          status: process.env[key] ? 'ok' : 'error',
          error: !process.env[key] ? 'Missing' : undefined
        }
      ])
    );
  }

  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      overview: {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version,
        deployment: {
          url: process.env.VERCEL_URL,
          environment: process.env.VERCEL_ENV,
          region: process.env.VERCEL_REGION
        }
      },
      tests: {
        environment: testEnvironmentVariables(),
        database: await testDatabaseTables(),
        redis: await testRedisOperations(),
        auth0: await testAuth0Endpoints(),
        api: await testAPIRoutes()
      }
    };

    // Count failures - fixed the unused parameter
    const failures = Object.entries(diagnostics.tests)
      .flatMap(([category, tests]) => 
        Object.entries(tests)
          .filter(([, result]) => result.status === 'error')
          .map(([name, result]) => ({
            category,
            name,
            error: result.error
          }))
      );

    return new Response(JSON.stringify({
      ...diagnostics,
      summary: {
        total_tests: Object.values(diagnostics.tests)
          .flatMap(tests => Object.keys(tests)).length,
        failures: failures.length,
        failed_components: failures
      }
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}