/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

for (const product of ['soundscaper', 'framescaper']) {
	test(`${product} Debian packages recommend FFmpeg without requiring it`, async () => {
		const { stdout } = await execute(process.execPath, ['-e',
			"process.stdout.write(JSON.stringify(require('./electron-builder.config.cjs')))"], {
			cwd: new URL('..', import.meta.url),
			env: { ...process.env, SCAPE_PRODUCT: product, SCAPE_MAC_SIGNING: 'false', SCAPE_WIN_SIGNING: 'none' },
		});
		const config = JSON.parse(stdout) as {
			deb: { recommends?: string[]; depends?: string[] };
		};
		assert.ok(config.deb.recommends?.includes('ffmpeg'));
		assert.ok(!config.deb.depends?.some((dependency) => /\bffmpeg\b/u.test(dependency)));
	});
}
