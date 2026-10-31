/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consumeExternalFfmpegInstallerConsent } from '../desktop/external-ffmpeg-installer-consent.ts';

test('installer consent authorizes discovery only once', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-installer-consent-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const marker = join(directory, 'ffmpeg-installer-consent');
	assert.equal(await consumeExternalFfmpegInstallerConsent(directory), false);
	await writeFile(marker, '1\n');
	assert.equal(await consumeExternalFfmpegInstallerConsent(directory), true);
	assert.equal(await consumeExternalFfmpegInstallerConsent(directory), false);
});

test('invalid or symbolic markers never authorize FFmpeg execution', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-installer-consent-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const marker = join(directory, 'ffmpeg-installer-consent');
	for (const contents of ['', '0\n', '1\nextra', 'x'.repeat(4096)]) {
		await writeFile(marker, contents);
		assert.equal(await consumeExternalFfmpegInstallerConsent(directory), false);
	}
	await rm(marker);
	const target = join(directory, 'unrelated');
	await writeFile(target, '1\n');
	try { await symlink(target, marker); }
	catch (error) {
		if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return;
		throw error;
	}
	assert.equal(await consumeExternalFfmpegInstallerConsent(directory), false);
	assert.equal(await readFile(target, 'utf8'), '1\n');
});
