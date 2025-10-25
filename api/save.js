export const runtime = 'edge';
import { put } from '@vercel/blob';

export async function POST(req) {
  try {
    const adminKey = process.env.ADMIN_KEY || '';
    const sentKey = req.headers.get('x-admin-key') || '';
    if (!adminKey || sentKey !== adminKey) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const key = 'family/family-data.json';
    await put(key, JSON.stringify(payload, null, 2), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json; charset=utf-8'
    });

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e?.message || 'Server error' }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
