export const runtime = 'edge';
import { list } from '@vercel/blob';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'family/family-data.json' });
    if (!blobs?.length) return json({ people: {} });
    const url = blobs[0].downloadUrl || blobs[0].url;
    const res = await fetch(url, { cache: 'no-store' });
    const jsonData = await res.json();
    return json(jsonData);
  } catch (e) {
    // Always return valid JSON so the client never tries to parse HTML
    return json({ people: {}, error: e?.message || 'Load failed' }, 200);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
