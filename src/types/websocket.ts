export type WSMessageType = 'hello' | 'echo' | 'broadcast';

export interface WSMessage {
  type: WSMessageType;
  data?: unknown;
}