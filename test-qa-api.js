const http = require('http');

// Test fetching QA trees for a specific market
const testMarketId = 'test-market-456';

const options = {
  hostname: 'localhost',
  port: 3001,
  path: `/api/qa-trees?marketId=${testMarketId}`,
  method: 'GET'
};

const req = http.request(options, res => {
  console.log(`Status Code: ${res.statusCode}`);
  
  let data = '';
  
  res.on('data', chunk => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response data:', JSON.parse(data));
  });
});

req.on('error', error => {
  console.error('Error:', error);
});

req.end();