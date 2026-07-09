// Pure attach-or-own decision logic (M7 plan item 2), kept free of any
// 'electron' import so it can run under vitest like the rest of the suite —
// main.ts is the only place that wires this into app lifecycle.

export type ProbeResult = 'healthy' | 'occupied' | 'unreachable';
export type AttachDecision = 'attach' | 'own' | 'conflict';

// GETs /api/v1/health on the candidate port. 'healthy' means a MemoryCastle
// server already answers there (attach, don't start a second one);
// 'occupied' means something else answers (a real port conflict);
// 'unreachable' means nothing is listening (we're free to own the port).
export async function probeHealth(port: number, timeoutMs = 800): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: controller.signal });
    if (!res.ok) return 'occupied';
    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object' && (body as { ok?: unknown }).ok === true) return 'healthy';
    return 'occupied';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export function decideFromProbe(probe: ProbeResult): AttachDecision {
  if (probe === 'healthy') return 'attach';
  if (probe === 'unreachable') return 'own';
  return 'conflict';
}
