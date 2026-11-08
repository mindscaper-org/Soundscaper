/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { packageDesktopNightlyTestProducts } from '../scripts/desktop-nightly-tests-products.mjs';

const execute = promisify(execFile);

for (const arch of ['x64', 'arm64']) {
	test(`Windows ${arch} packaging passes a preload URL that Node can load from a path with spaces, # and %`, async context => {
		const root = await mkdtemp(join(tmpdir(), 'scape preload # %-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		await mkdir(join(root, 'scripts'));
		const preload = join(root, 'scripts/ci-github-release-fetch.mjs');
		await writeFile(preload, 'globalThis.__nightlyPreloadUrl = import.meta.url;\n');
		const captured = new Error('Builder invocation checked');
		let invocations = 0;
		await assert.rejects(packageDesktopNightlyTestProducts({
			repositoryRoot: root, outputRoot: join(root, 'output'), platform: 'win', arch,
			sourceRevision: '0'.repeat(40), environment: {},
			run: async (command: string, args: readonly string[]) => {
				if (args.some(argument => argument.endsWith('desktop-prepare.mjs'))) return;
				invocations += 1;
				assert.equal(args[0], '--import');
				const { stdout } = await execute(command, [args[0], args[1]!, '--input-type=module', '--eval',
					'process.stdout.write(globalThis.__nightlyPreloadUrl);'], { cwd: root });
				assert.equal(stdout, pathToFileURL(preload).href);
				assert.equal(args[1], stdout);
				throw captured;
			},
		}), error => error === captured);
		assert.equal(invocations, 1);
	});
}
