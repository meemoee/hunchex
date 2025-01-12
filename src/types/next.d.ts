// src/types/next.d.ts
declare module 'next/server' {
  export type RouteHandlerParams<T extends Record<string, string>> = {
    params: T;
  }
}