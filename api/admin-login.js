// api/admin-login.js
export const runtime = 'edge';

export async function POST(request) {
  const { password } = await request.json();
  const expectedAdminKey = process.env.ADMIN_KEY;

  if (!expectedAdminKey) {
    console.warn('ADMIN_KEY environment variable is not set. Login is always successful.');
    // For local development or if you don't care about auth for now
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const success = password === expectedAdminKey;
  return new Response(JSON.stringify({ success }), { status: success ? 200 : 401, headers: { 'Content-Type': 'application/json' } });
}
