interface WSMessage {
  type: string;
  data: unknown;
}

export class WebSocketHandler {
  private clients = new Map<string, WebSocket>();

  static async upgrade(req: NextRequest) {
    if (!req.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
      return { socket: null, response: null };
    }

    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      return { socket, response };
    } catch (err) {
      console.error('WebSocket upgrade failed:', err);
      return { socket: null, response: null };
    }
  }

  addClient(userId: string, socket: WebSocket) {
    // Setup socket handlers
    socket.onopen = () => {
      console.log(`Client connected: ${userId}`);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(userId, data);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    };

    socket.onclose = () => {
      this.removeClient(userId);
    };

    this.clients.set(userId, socket);
  }

  removeClient(userId: string) {
    this.clients.delete(userId);
  }

  private handleMessage(userId: string, data: WSMessage) {
    // Basic echo for testing
    const socket = this.clients.get(userId);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'echo',
        data
      }));
    }
  }

  broadcast(message: WSMessage) {
    this.clients.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    });
  }
}
