export const runtime = 'edge';

// Update this to your Express WebSocket server URL
const WS_SERVER_URL = process.env.WS_SERVER_URL || 'ws://localhost:3001';

export async function GET(req: Request) {
  const upgradeHeader = req.headers.get('upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      return new Response('Missing token', { status: 400 });
    }

    // Construct WebSocket URL for the Express server
    const wsUrl = new URL(WS_SERVER_URL);
    wsUrl.searchParams.set('token', token);

    // Create streams for proxying
    const { readable, writable } = new TransformStream();

    // Start proxying in the background
    proxyWebSocket(wsUrl.toString(), writable).catch(console.error);

    // Return the upgrade response with the readable stream
    return new Response(readable, {
      status: 101,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Accept': req.headers.get('sec-websocket-key') || '',
        'Sec-WebSocket-Protocol': req.headers.get('sec-websocket-protocol') || ''
      }
    });
  } catch (err) {
    console.error('WebSocket proxy error:', err);
    return new Response('WebSocket proxy failed', { status: 500 });
  }
}

async function proxyWebSocket(url: string, writable: WritableStream) {
  const encoder = new TextEncoder();
  const writer = writable.getWriter();
  
  try {
    // Connect to Express WebSocket server
    const ws = new WebSocket(url);
    
    ws.onmessage = async (event) => {
      // Forward messages from Express to client
      await writer.write(encoder.encode(event.data));
    };

    ws.onclose = async () => {
      await writer.close();
    };

    ws.onerror = async (error) => {
      console.error('Proxy WebSocket error:', error);
      await writer.abort(error);
    };
  } catch (error) {
    console.error('Proxy connection error:', error);
    await writer.abort(error);
  }
}