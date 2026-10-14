import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PublishingError } from './core.mjs';

const execute = promisify(execFile);

/** Scan exactly the sanitized file that will become a public GitHub commit. */
export async function scanPublicState(content, additionalFiles = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lula-instagram-state-'));
  try {
    await writeFile(join(directory, 'state.json'), content, { mode: 0o600 });
    for (const [filename, value] of Object.entries(additionalFiles)) {
      if (filename !== 'vercel.json' || typeof value !== 'string') throw new PublishingError('INVALID_PUBLIC_SCAN_FILE');
      await writeFile(join(directory, filename), value, { mode: 0o600 });
    }
    await execute(resolve('.git/tools/gitleaks'), ['dir', directory, '--redact', '--no-banner', '--exit-code', '1'], {
      timeout: 30_000, maxBuffer: 1024 * 1024,
    });
  } catch { throw new PublishingError('PUBLIC_STATE_SECRET_SCAN_FAILED'); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
