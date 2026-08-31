// Minimal content-addressed blob store for map images. The scene graph stays
// in SpacetimeDB; bulky binary assets live here (dev: local disk; the hosted
// service swaps this for object storage behind the same two routes).
//
//   PUT  /blobs        body = raw bytes  -> { "url": ".../blobs/<sha256>.<ext>" }
//   GET  /blobs/<name> -> bytes
//
// Run: pnpm blobd   (defaults: port 8787, data dir .data/blobs)
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, basename } from 'node:path';

const PORT = Number(process.env.BLOBD_PORT ?? 8787);
const DATA_DIR = process.env.BLOBD_DIR ?? '.data/blobs';
const MAX_BYTES = 64 * 1024 * 1024;

mkdirSync(DATA_DIR, { recursive: true });

const MAGIC = [
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { ext: 'webp', mime: 'image/webp', test: (b) => b[8] === 0x57 && b[9] === 0x45 },
];
const mimeFor = (name) =>
  MAGIC.find((m) => name.endsWith(`.${m.ext}`))?.mime ?? 'application/octet-stream';

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (req.method === 'PUT' && req.url === '/blobs') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) return res.writeHead(413).end('too large');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const kind = MAGIC.find((m) => m.test(bytes));
      if (!kind) return res.writeHead(415).end('expected png/jpg/webp');
      const name = `${createHash('sha256').update(bytes).digest('hex')}.${kind.ext}`;
      const path = join(DATA_DIR, name);
      if (!existsSync(path)) await writeFile(path, bytes);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ url: `http://localhost:${PORT}/blobs/${name}` }));
    }

    if (req.method === 'GET' && req.url?.startsWith('/blobs/')) {
      const name = basename(req.url.slice('/blobs/'.length));
      if (!/^[0-9a-f]{64}\.[a-z0-9]+$/.test(name)) return res.writeHead(400).end();
      const bytes = await readFile(join(DATA_DIR, name)).catch(() => null);
      if (!bytes) return res.writeHead(404).end();
      res.setHeader('Content-Type', mimeFor(name));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.end(bytes);
    }

    if (req.method === 'GET' && req.url === '/health') {
      const count = (await readdir(DATA_DIR)).length;
      return res.end(`ok ${count} blobs`);
    }

    res.writeHead(404).end();
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
});

server.listen(PORT, () => console.log(`blobd on :${PORT}, data in ${DATA_DIR}`));
