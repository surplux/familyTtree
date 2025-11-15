// api/save.js
import { put } from '@vercel/blob';

export const runtime = 'edge';

export async function POST(req) {
  try {
    const adminKey = process.env.ADMIN_KEY || '';
    const sentKey = req.headers.get('x-admin-key') || '';

    if (!adminKey || sentKey !== adminKey) {
      console.error('Save error: unauthorized', { hasAdminKey: !!adminKey, sentKey });
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      console.error('Save error: invalid JSON body');
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const key = 'family/family-data.json';

    const result = await put(
      key,
      JSON.stringify(payload, null, 2),
      {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true, // 👈 THIS MUST BE HERE
        contentType: 'application/json; charset=utf-8',
      }
    );

    console.log('Save success, blob key:', result.pathname);

    return json({ ok: true });
  } catch (e) {
    console.error('Save error: unexpected', e);
    return json({ ok: false, error: e?.message || 'Server error' }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
