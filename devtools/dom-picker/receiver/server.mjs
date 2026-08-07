#!/usr/bin/env node
/**
 * Local dump receiver for the DOM Dump Picker extension.
 * Writes captures under ../dumps/ for the agent to read.
 */
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DUMPS_DIR = join(ROOT, 'dumps');
const PORT = Number(process.env.DOM_DUMP_PORT || 17373);
const HOST = process.env.DOM_DUMP_HOST || '127.0.0.1';

await mkdir(DUMPS_DIR, { recursive: true });

function send(res, status, body, type = 'application/json') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, {
      ok: true,
      dumpsDir: DUMPS_DIR,
      latestHtml: join(DUMPS_DIR, 'latest.html'),
      latestJson: join(DUMPS_DIR, 'latest.json'),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/latest') {
    const jsonPath = join(DUMPS_DIR, 'latest.json');
    if (!existsSync(jsonPath)) {
      send(res, 404, { ok: false, error: 'No dump yet' });
      return;
    }
    const raw = await readFile(jsonPath, 'utf8');
    send(res, 200, raw, 'application/json');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/dump') {
    try {
      const raw = await readBody(req);
      const packet = JSON.parse(raw);
      const id = stamp();
      const outerHTML =
        typeof packet.outerHTML === 'string' ? packet.outerHTML : '';

      if (!outerHTML) {
        send(res, 400, { ok: false, error: 'outerHTML required' });
        return;
      }

      const meta = {
        id,
        capturedAt: new Date().toISOString(),
        url: packet.url ?? null,
        title: packet.title ?? null,
        tagName: packet.tagName ?? null,
        idAttr: packet.id ?? null,
        className: packet.className ?? null,
        attrs: packet.attrs ?? {},
        depth: packet.depth ?? 0,
        rect: packet.rect ?? null,
        computed: packet.computed ?? null,
        notes: packet.notes ?? null,
        byteLength: Buffer.byteLength(outerHTML, 'utf8'),
        paths: {
          html: join(DUMPS_DIR, 'latest.html'),
          json: join(DUMPS_DIR, 'latest.json'),
          archiveHtml: join(DUMPS_DIR, `${id}.html`),
          archiveJson: join(DUMPS_DIR, `${id}.json`),
        },
      };

      const archiveJson = { ...meta, outerHTML };
      await writeFile(meta.paths.html, outerHTML, 'utf8');
      await writeFile(meta.paths.json, JSON.stringify(archiveJson, null, 2), 'utf8');
      await writeFile(meta.paths.archiveHtml, outerHTML, 'utf8');
      await writeFile(
        meta.paths.archiveJson,
        JSON.stringify(archiveJson, null, 2),
        'utf8',
      );

      console.log(
        `[dom-dump] captured ${meta.tagName ?? '?'} (${meta.byteLength} bytes) → ${meta.paths.html}`,
      );
      send(res, 200, { ok: true, ...meta });
    } catch (error) {
      console.error('[dom-dump] failed', error);
      send(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[dom-dump] listening on http://${HOST}:${PORT}`);
  console.log(`[dom-dump] dumps → ${DUMPS_DIR}`);
  console.log('[dom-dump] POST /dump  GET /health  GET /latest');
});
