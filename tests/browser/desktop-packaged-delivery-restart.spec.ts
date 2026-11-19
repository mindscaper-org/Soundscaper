/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { runBoundedSmokeChild } from '../../scripts/lib/desktop-smoke-child.mjs';
import { resolvePackagedProductExecutable } from '../../scripts/lib/desktop-packaged-product-executable.mjs';

test('packaged delivery recovers the exact publication after a real process crash', async ({ browserName: _browserName }, testInfo) => {
	test.skip(process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS !== '1', 'Runs from the nightly packaged Electron collection.');
	test.setTimeout(180_000);
	const executable = resolvePackagedProductExecutable({
		productRoot: process.env.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT, productId: 'soundscaper',
		platform: process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform,
		arch: process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch,
	});
	const profile = await mkdtemp(join(tmpdir(), 'nightly-delivery-crash-'));
	const token = randomBytes(16).toString('hex');
	const output = join(profile, `persistent-delivery-restart-${token}`);
	const environment = { ...process.env };
	delete environment.ELECTRON_RUN_AS_NODE;
	delete environment.NODE_V8_COVERAGE;
	try {
		const interrupted = await launch('interrupt-publication');
		assert.equal(interrupted.code, 86, interrupted.stdout + interrupted.stderr);
		const before = await publishedBytes();
		assert.equal(before.length, 46, 'the crash must leave the native WAV publication in place');
		assert.equal(before.toString('ascii', 0, 4), 'RIFF');
		assert.equal(before.toString('ascii', 8, 12), 'WAVE');
		const recovered = await launch('recover-publication');
		assert.equal(recovered.code, 0, recovered.stdout + recovered.stderr);
		assert.deepEqual(await publishedBytes(), before, 'recovery must preserve the exact already-published bytes');
		const prefix = 'SOUNDSCAPER_DELIVERY_RESTART_PUBLICATION_SMOKE ';
		const lines = recovered.stdout.split(/\r?\n/u).filter(line => line.startsWith(prefix));
		assert.equal(lines.length, 1, recovered.stdout);
		const evidence: unknown = JSON.parse(lines[0]!.slice(prefix.length));
		assert.deepEqual(evidence, {
			schemaVersion: 1, mode: 'soundscaper-delivery-restart-publication', productId: 'soundscaper', token,
			state: 'completed', attempt: 1, recoveredPreparedJournal: true, persistedReport: true,
			publication: { fileName: 'restart-master.wav', byteLength: before.length,
				sha256: createHash('sha256').update(before).digest('hex') },
			visibleFiles: ['restart-master.wav'],
		});
		await testInfo.attach('delivery-crash-recovery.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
	} finally {
		await rm(profile, { recursive: true, force: true });
	}

	async function launch(stage: 'interrupt-publication' | 'recover-publication') {
		// Independent valid input to the shipped smoke entrypoint; do not import its runtime or replace its helper.
		const plan = Buffer.from(JSON.stringify({ schemaVersion: 1, mode: 'soundscaper-delivery-restart-publication',
			productId: 'soundscaper', stage, token })).toString('base64url');
		const result = await runBoundedSmokeChild(executable, [
			`--user-data-dir=${profile}`, `--soundscaper-delivery-restart-publication-smoke=${plan}`, '--lang=en', '--mute-audio',
		], { cwd: process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT,
			environment, outputLimit: 1024 ** 2, timeout: 75_000, label: 'nightly delivery recovery', errorEvent: 'once' });
		return result as { code: number | null; stdout: string; stderr: string };
	}

	async function publishedBytes(): Promise<Buffer> {
		assert.deepEqual((await readdir(output)).sort(), ['restart-master.wav']);
		const file = join(output, 'restart-master.wav');
		const stat = await lstat(file);
		assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size === 46);
		return readFile(file);
	}
});
