/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (text: string) => {
	jobs: { tests: { steps: { name?: string; run?: string }[] } };
} };

for (const workflow of ['quality', 'desktop-preview']) {
	test(`${workflow} retries Electron installation and still rejects an exhausted download`, { skip: process.platform === 'win32' }, async context => {
		const source = await readFile(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
		const run = load(source).jobs.tests.steps.find(step => step.name === 'Restore Electron binary for the desktop protocol test')?.run;
		assert.ok(run);
		const directory = await mkdtemp(join(tmpdir(), 'scape-electron-retry-'));
		context.after(() => rm(directory, { recursive: true, force: true }));
		const bin = join(directory, 'bin');
		await mkdir(bin);
		await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
		await writeFile(join(bin, 'node'), `#!/bin/sh
count=0
if [ -f "$ELECTRON_RETRY_FIXTURE/attempts" ]; then count=$(cat "$ELECTRON_RETRY_FIXTURE/attempts"); fi
count=$((count + 1))
echo "$count" > "$ELECTRON_RETRY_FIXTURE/attempts"
if [ "$count" -lt "$ELECTRON_RETRY_SUCCESS" ]; then exit 1; fi
mkdir -p node_modules/electron/dist
touch node_modules/electron/dist/electron
chmod +x node_modules/electron/dist/electron
`, { mode: 0o755 });
		const invoke = (success: number) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', run], {
			cwd: directory, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
				ELECTRON_RETRY_FIXTURE: directory, ELECTRON_RETRY_SUCCESS: String(success) },
		});
		assert.equal(invoke(3).status, 0, 'the third installation can recover a transient failure');
		assert.equal(await readFile(join(directory, 'attempts'), 'utf8'), '3\n');
		assert.equal(invoke(99).status, 0, 'an existing executable bypasses installation');
		assert.equal(await readFile(join(directory, 'attempts'), 'utf8'), '3\n');
		await chmod(join(directory, 'node_modules/electron/dist/electron'), 0o644);
		await rm(join(directory, 'attempts'));
		assert.notEqual(invoke(99).status, 0, 'exhausted retries must fail the job');
		assert.equal(await readFile(join(directory, 'attempts'), 'utf8'), '3\n');
	});
}
