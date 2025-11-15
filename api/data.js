// api/data.js
import { put, head, BlobNotFoundError } from '@vercel/blob';

export const runtime = 'edge'; // For Vercel Edge Functions

const BLOB_FILE_NAME = 'family-tree-data.json'; // The name of your JSON file in Blob storage

async function authorizeAdmin(request) {
  const adminKey = request.headers.get('X-Admin-Key');
  const expectedAdminKey = process.env.ADMIN_KEY;

  if (!expectedAdminKey) {
    console.warn(
      'ADMIN_KEY environment variable is not set. Admin features are unsecured.',
    );
    // For dev you allow it, for prod you might want `return false` here.
    return true;
  }

  return adminKey === expectedAdminKey;
}

// ---------- GET: read JSON from Blob ----------
export async function GET() {
  try {
    // 1) Get blob metadata (includes the URL)
    const blobMeta = await head(BLOB_FILE_NAME);

    // 2) Fetch the actual file contents from the blob URL
    const res = await fetch(blobMeta.url);

    if (!res.ok) {
      const text = await res.text();
      console.error('Error fetching blob contents:', res.status, text);
      return new Response(
        JSON.stringify({ error: 'Failed to download blob contents' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = await res.json();

    // 3) Return JSON to the client
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // Specific "not found" handling
    if (error instanceof BlobNotFoundError) {
      console.warn('Blob not found:', BLOB_FILE_NAME);
      return new Response(
        JSON.stringify({ error: 'No data found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.error('Error reading from Blob:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to retrieve data' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ---------- POST: write JSON to Blob ----------
export async function POST(request) {
  if (!(await authorizeAdmin(request))) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const data = await request.json();

    const blob = await put(
      BLOB_FILE_NAME,
      JSON.stringify(data, null, 2),
      {
        access: 'public',              // or 'private', depending on what you want
        contentType: 'application/json',
        // you can also add cacheControlMaxAge, etc here if needed
      },
    );

    return new Response(
      JSON.stringify({ message: 'Data saved successfully', url: blob.url }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error writing to Blob:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to save data' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
