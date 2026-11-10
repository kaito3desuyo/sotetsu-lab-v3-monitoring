import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../lib/layers/bundle.sh');
const fixture = resolve(import.meta.dirname, 'fixture');

const run = (env: Record<string, string>) =>
  spawnSync(script, {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 60_000,
  });

const tempDir = () => mkdtempSync(join(tmpdir(), 'bundle-test-'));

describe('bundle.sh', () => {
  it('nodejs/node_modules を作る', () => {
    const out = tempDir();
    const result = run({ BUNDLER_OUTPUT_DIR: out, BUNDLER_ROOT_DIR: fixture });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(out, 'nodejs/node_modules/ms/package.json'))).toBe(true);
  }, 90_000);

  it('cp の失敗で止まる', () => {
    const result = run({ BUNDLER_OUTPUT_DIR: tempDir(), BUNDLER_ROOT_DIR: tempDir() });
    expect(result.status).not.toBe(0);
  });

  it('BUNDLER_OUTPUT_DIR が無ければ止まる', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, BUNDLER_ROOT_DIR: fixture };
    delete env.BUNDLER_OUTPUT_DIR;
    const result = spawnSync(script, { env, encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
  });
});
