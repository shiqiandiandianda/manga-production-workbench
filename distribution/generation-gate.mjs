// Account-wide generation gate shared by every local image channel.
// A 429/quota answer in one process pauses the others too, so parallel channels
// cannot keep hammering the same Codex account while it is rate limited.
import fs from 'node:fs';
import path from 'node:path';

export function gatePath(root = process.cwd()) {
  return process.env.COMIC_GENERATION_GATE || path.join(process.env.WORKBENCH_RELEASE_DATA_ROOT || path.join(root, 'runtime-data'), 'generation-gate.json');
}

export function readGate(file = gatePath()) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { until: Number(value.until) || 0, reason: String(value.reason || ''), updatedAt: value.updatedAt || null, strikes: Number(value.strikes) || 0 };
  } catch { return { until: 0, reason: '', updatedAt: null, strikes: 0 }; }
}

export function gateBlocked(file = gatePath(), now = Date.now()) {
  return readGate(file).until > now;
}

export function blockGate(file = gatePath(), untilOrDelay, reason = 'codex_rate_limited', strikes = 0) {
  const until = Number(untilOrDelay) > 1e12 ? Number(untilOrDelay) : Date.now() + Math.max(1000, Number(untilOrDelay) || 0);
  const target = file || gatePath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = target + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ until, reason, strikes, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch { /* a gate write failure must never break generation */ }
  return { until, reason, strikes };
}

export function clearGate(file = gatePath()) {
  try { fs.unlinkSync(file || gatePath()); } catch { /* already gone */ }
  return { until: 0, reason: '', strikes: 0 };
}
