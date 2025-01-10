import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Forward the request to the Express backend with proper auth
    const response = await fetch('http://localhost:3001/api/qa-trees/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
        'x-user-id': session.user.sub,
        'Cookie': request.headers.get('cookie') || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Try to parse error response as JSON
      try {
        const error = await response.json();
        return NextResponse.json(
          { error: error.message || 'Failed to generate QA tree' },
          { status: response.status }
        );
      } catch {
        // If response isn't JSON (e.g. HTML error page)
        return NextResponse.json(
          { error: 'Authentication failed' },
          { status: response.status }
        );
      }
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('Error in QA tree generation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
