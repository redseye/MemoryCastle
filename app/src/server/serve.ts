// Node bootstrap for the Hono app. Binds 127.0.0.1 only — loopback binding is
// the security boundary (plan §5: no auth, no CORS). Hostname is not
// exposed as an option: the CLI never has a reason to bind anywhere else.

import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import type { CreateAppOptions } from './app.js';
import { createProductionApp } from './static-app.js';

export interface StartServerOptions extends CreateAppOptions {
  port: number;
  // Path to the built web UI (dist/public). When given and present on disk,
  // the API and UI are served together on one port (plan §5/M6); otherwise
  // this falls back to the API-only app (dev/test, or a build that hasn't
  // run `npm run web:build` yet).
  publicDir?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  servingUi: boolean;
  close(): Promise<void>;
}

export function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { port, publicDir, ...appOptions } = options;
  const servingUi = !!publicDir && existsSync(publicDir);
  const app = servingUi ? createProductionApp(publicDir!, appOptions) : createApp(appOptions);

  return new Promise((resolvePromise, reject) => {
    const server: ServerType = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info: AddressInfo) => {
      resolvePromise({
        port: info.port,
        url: `http://127.0.0.1:${info.port}/api/v1`,
        servingUi,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.on('error', reject);
  });
}
