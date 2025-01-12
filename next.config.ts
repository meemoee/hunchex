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
    return [
      {
        source: '/api/top_movers',
        destination: 'http://localhost:3001/api/top_movers'
      },
      {
        source: '/api/qa-trees',
        destination: 'http://localhost:3001/api/qa-trees',
        has: [
          {
            type: 'header',
            key: 'cookie',
          }
        ]
      },
      {
        source: '/api/qa-trees/generate',
        destination: 'http://localhost:3001/api/qa-trees/generate',
        has: [
          {
            type: 'header',
            key: 'cookie',
          }
        ]
      },
      {
        source: '/api/qa-tree/:id',
        destination: 'http://localhost:3001/api/qa-tree/:id',
        has: [
          {
            type: 'header',
            key: 'cookie',
          }
        ]
      },
      {
        source: '/api/chat',
        destination: 'http://localhost:3001/api/chat'
      },
      {
        source: '/api/balance',
        destination: 'http://localhost:3000/api/balance'
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