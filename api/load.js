export const runtime = 'edge';

import { list } from '@vercel/blob';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'family/family-data.json' });
    if (!blobs || blobs.length === 0) {
      // Nothing saved yet — return an empty dataset
      return new Response(JSON.stringify({ people: {} }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const url = blobs[0].downloadUrl || blobs[0].url;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return new Response(JSON.stringify(json), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ people: {} }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  }
}
