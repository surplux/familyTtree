// api/upload-photo.js
import { put } from '@vercel/blob';

export const runtime = 'edge';

async function authorizeAdmin(request) {
  const adminKey = request.headers.get('X-Admin-Key');
  const expectedAdminKey = process.env.ADMIN_KEY;

  if (!expectedAdminKey) {
    console.warn('ADMIN_KEY environment variable is not set. Admin features are unsecured.');
    return true;
  }
  return adminKey === expectedAdminKey;
}

export async function POST(request) {
  if (!(await authorizeAdmin(request))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const { dataURL } = await request.json();
    if (!dataURL || !dataURL.startsWith('data:image/')) {
      return new Response(JSON.stringify({ error: 'Invalid image data' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Extract base64 part and content type
    const parts = dataURL.split(';');
    const contentType = parts[0].split(':')[1];
    const base64Data = parts[1].split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate a unique filename (e.g., using a timestamp or UUID)
    const filename = `photos/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${contentType.split('/')[1]}`;

    const blob = await put(filename, buffer, {
      access: 'public', // Photos usually need to be public
      contentType: contentType,
    });

    return new Response(JSON.stringify({ url: blob.url }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("Error uploading photo to Blob:", error);
    return new Response(JSON.stringify({ error: 'Failed to upload photo' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
