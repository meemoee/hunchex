/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
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
		  destination: 'http://localhost:3001/api/qa-trees'
		},
		{
		  source: '/api/balance',
		  destination: 'http://localhost:3000/api/balance'  // or your appropriate backend port
		}
	  ]
	},
  async headers() {
    return [
      {
        source: '/api/top_movers',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ]
      }
    ]
  }
};

export default nextConfig;
