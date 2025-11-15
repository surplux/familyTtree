// api/data.js
import { put, get } from '@vercel/blob';

export const runtime = 'edge'; // For Vercel Edge Functions

const BLOB_FILE_NAME = 'family-tree-data.json'; // The name of your JSON file in Blob storage

async function authorizeAdmin(request) {
  const adminKey = request.headers.get('X-Admin-Key');
  const expectedAdminKey = process.env.ADMIN_KEY;

  if (!expectedAdminKey) {
    console.warn('ADMIN_KEY environment variable is not set. Admin features are unsecured.');
    // In a production app, you might want to disallow admin operations if key is missing.
    return true; // For development, allow if key is not set.
  }

  return adminKey === expectedAdminKey;
}

export async function GET(request) {
  try {
    const blob = await get(BLOB_FILE_NAME, { type: 'json' });
    if (!blob) {
      // If the blob doesn't exist, return a 404
      return new Response(JSON.stringify({ error: 'No data found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await blob.json(); // Vercel Blob's get can automatically parse JSON
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("Error reading from Blob:", error);
    return new Response(JSON.stringify({ error: 'Failed to retrieve data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function POST(request) {
  if (!(await authorizeAdmin(request))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const data = await request.json();
    const blob = await put(BLOB_FILE_NAME, JSON.stringify(data, null, 2), {
      access: 'public', // Set to 'public' if you want it accessible directly via URL, 'private' otherwise
      contentType: 'application/json',
    });
    return new Response(JSON.stringify({ message: 'Data saved successfully', url: blob.url }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("Error writing to Blob:", error);
    return new Response(JSON.stringify({ error: 'Failed to save data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
