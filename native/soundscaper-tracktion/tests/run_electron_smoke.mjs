/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [electron, ...args] = process.argv.slice(2);
if (!electron) throw new Error('Pass the Electron executable followed by the Tracktion smoke options.');
const scratch = mkdtempSync(join(tmpdir(), 'soundscaper-tracktion-electron-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
	execFileSync(electron, [resolve(import.meta.dirname, 'electron_smoke.ts'), `--tracktion-scratch=${scratch}`, ...args], {
		env, stdio: 'inherit', windowsHide: true,
	});
} finally {
	// Chromium holds files in its profile on Windows until the Electron process exits.
	rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
}
