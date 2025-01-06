import { useState, useEffect } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';

type UpdateType = 'holdings_update' | 'orders_update' | 'balance_update';

export function useWebSocket() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useUser();

  useEffect(() => {
    if (!user) return;

    // Get Auth0 access token from session
    const getAccessToken = async () => {
      const response = await fetch('/api/auth/token');
      const { accessToken } = await response.json();
      return accessToken;
    };

    getAccessToken().then(token => {
      const ws = new WebSocket('ws://localhost:3001/ws');

      ws.onopen = () => {
        // Authenticate with Auth0 token
        ws.send(JSON.stringify({
          type: 'auth',
          token: token
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'auth_success') {
          setIsConnected(true);
        }
      };

    ws.onclose = () => {
      setIsConnected(false);
    };

    setSocket(ws);

    return () => {
      ws.close();
    };
  }, [user]);

  const subscribeToUpdates = (
    callback: (type: UpdateType, data: any) => void
  ) => {
    if (!socket) return;

    socket.onmessage = (event) => {
      console.log('Debug (websocket.ts): Incoming raw message', event.data);
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'holdings_update':
        case 'orders_update':
        case 'balance_update':
          callback(data.type, data);
          break;
      }
    };
  };

  return { socket, isConnected, subscribeToUpdates };
}
