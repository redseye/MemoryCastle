// Native folder picker for the "register new project" form (plan M9). The
// actual spawn/lock/encoding logic lives in ../pick-folder.ts; this route
// only maps its result kinds onto HTTP. `deps.pickFolderFn` exists solely so
// tests can inject a fake result without going through the real module (e.g.
// to exercise the not_supported/busy/timeout HTTP mapping on a machine where
// the real pickFolder() would never take that branch) — production callers
// never pass it.

import type { Hono } from 'hono';
import { HttpError } from '../http-errors.js';
import { pickFolder as pickFolderReal } from '../pick-folder.js';

export function registerSystemRoutes(app: Hono, deps: { pickFolderFn?: typeof pickFolderReal } = {}): void {
  const pickFolderFn = deps.pickFolderFn ?? pickFolderReal;

  app.post('/system/pick-folder', async (c) => {
    // Test-only seam, documented in docs/api.md: set to a literal path to
    // return it immediately, or to "cancel" to simulate a cancelled dialog —
    // skips spawning PowerShell entirely. Never set in production use.
    const fake = process.env.MEMORYCASTLE_FAKE_PICKER;
    if (fake !== undefined) {
      if (fake === 'cancel') return c.json({ cancelled: true });
      return c.json({ path: fake });
    }

    // Test-only seam: shortens the real spawn's timeout so a test can drive
    // the timeout path without waiting the full default (5 minutes).
    const timeoutOverride = Number(process.env.MEMORYCASTLE_PICKER_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : undefined;

    const result = await pickFolderFn({ timeoutMs });
    switch (result.kind) {
      case 'ok':
        return c.json({ path: result.path });
      case 'cancelled':
        return c.json({ cancelled: true });
      case 'not_supported':
        throw new HttpError(501, 'not_supported', '資料夾選擇器僅支援 Windows。');
      case 'busy':
        throw new HttpError(409, 'picker_busy', '已有選擇資料夾對話框開啟中，請先完成或取消。');
      case 'timeout':
        throw new HttpError(408, 'picker_timeout', '選擇資料夾逾時，對話框已自動關閉。');
    }
  });
}
