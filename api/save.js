export const runtime = 'edge';

import { put } from '@vercel/blob';

export async function POST(req) {
  const adminKey = process.env.ADMIN_KEY || '';
  const sentKey = req.headers.get('x-admin-key') || '';

  if (!adminKey || sentKey !== adminKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Store at a fixed key; overwrite each save (no random suffix)
  const key = 'family/family-data.json';

  try {
    await put(key, JSON.stringify(payload, null, 2), {
      access: 'private',                // keep blob private; loaded via this API
      addRandomSuffix: false,
      contentType: 'application/json; charset=utf-8',
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
