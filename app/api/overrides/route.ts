import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Public: the tracker applies these corrections on load. Read per request because /admin edits the file.
export async function GET() {
  try {
    const text = await readFile(path.join(process.cwd(), 'data', 'overrides.json'), 'utf8');
    return new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return Response.json({}, { headers: { 'cache-control': 'no-store' } });
  }
}
