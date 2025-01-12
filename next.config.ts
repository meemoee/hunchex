/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
        port: '',
        pathname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
        port: '',
        pathname: '**',
      }
    ],
  },
  webpack: (config: any): any => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    return config;
  },
  async rewrites() {
    // Default to self-hosted API endpoints in production if no API_BASE_URL is set
    const apiBaseUrl = process.env.NODE_ENV === 'production'
      ? (process.env.API_BASE_URL || 'https://hunchex.vercel.app')
      : 'http://localhost:3001';
    
    const balanceApiUrl = process.env.NODE_ENV === 'production'
      ? (process.env.BALANCE_API_URL || process.env.API_BASE_URL || 'https://hunchex.vercel.app')
      : 'http://localhost:3000';

    return [
      {
        source: '/api/top_movers',
        destination: `${apiBaseUrl}/api/top_movers`
      },
      {
        source: '/api/qa-trees',
        destination: `${apiBaseUrl}/api/qa-trees`,
        has: [
          {
            type: 'header',
            key: 'cookie',
          }
        ]
      },
      {
        source: '/api/qa-trees/generate',
        destination: `${apiBaseUrl}/api/qa-trees/generate`,
        has: [
          {
            type: 'header',
            key: 'cookie',
          }
        ]
      },
      {
        source: '/api/qa-tree/:id',
        destination: `${apiBaseUrl}/api/qa-tree/:id`,
        has: [
          {
            type: 'header',
            key: 'cookie',
          }
        ]
      },
      {
        source: '/api/chat',
        destination: `${apiBaseUrl}/api/chat`
      },
      {
        source: '/api/balance',
        destination: `${balanceApiUrl}/api/balance`
      }
    ];
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, Cookie, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' }
        ]
      }
    ];
  }
};

export default nextConfig;