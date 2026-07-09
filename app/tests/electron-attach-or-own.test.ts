// M7: the Electron main process must not start a second server when a
// MemoryCastle instance already owns the port, must own the port when it's
// free, and must refuse (dialog + quit, exercised only in main.ts) when
// something else entirely answers there. This covers the pure decision
// logic; main.ts wires it to app lifecycle and isn't testable under vitest.

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { decideFromProbe, probeHealth } from '../electron/attach-or-own.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function listen(handler: Parameters<typeof createServer>[0]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server!.address() as AddressInfo).port;
}

describe('probeHealth / decideFromProbe', () => {
  it('is unreachable when nothing listens on the port, so main should own it', async () => {
    const probe = await probeHealth(1, 100); // port 1: reserved, always refused
    expect(probe).toBe('unreachable');
    expect(decideFromProbe(probe)).toBe('own');
  });

  it('is healthy when a MemoryCastle server answers /api/v1/health, so main should attach', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '0.1.0', projects: 0 }));
    });
    const probe = await probeHealth(port);
    expect(probe).toBe('healthy');
    expect(decideFromProbe(probe)).toBe('attach');
  });

  it('is occupied when some other server answers, so main should conflict-quit', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not memorycastle');
    });
    const probe = await probeHealth(port);
    expect(probe).toBe('occupied');
    expect(decideFromProbe(probe)).toBe('conflict');
  });

  it('is occupied when the port answers with a non-2xx status', async () => {
    const port = await listen((req, res) => {
      res.writeHead(500);
      res.end('error');
    });
    const probe = await probeHealth(port);
    expect(probe).toBe('occupied');
    expect(decideFromProbe(probe)).toBe('conflict');
  });
});
