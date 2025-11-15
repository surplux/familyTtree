export const runtime = 'edge';

export async function GET() {
  const hasAdmin = !!process.env.ADMIN_KEY;
  const hasBlobToken =
    !!process.env.BLOB_READ_WRITE_TOKEN;

  return new Response(JSON.stringify({
    ok: true,
    adminKeyPresent: hasAdmin,
    blobTokenPresent: hasBlobToken
  }), { headers: { 'Content-Type': 'application/json' } });
}
