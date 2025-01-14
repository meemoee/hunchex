// src/middleware.ts
import { NextResponse } from 'next/dist/server/web/spec-extension/response';
 
export function middleware() {
  return NextResponse.next()
}
 
export const config = {
  matcher: []
}