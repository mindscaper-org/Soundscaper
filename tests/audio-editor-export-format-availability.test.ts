/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportFormatAvailability } from '../src/common/editor/controller/export/export-format-availability.ts';

const missing = { available: false, requiresFfmpeg: true, reasonCode: 'configure-external-ffmpeg' };

test('only a missing FFmpeg dependency offers installation; installation rechecks the chosen format', async () => {
	let installed = false;
	let installations = 0;
	const availability = createExportFormatAvailability({
		readFfmpegStatus: () => ({ state: installed ? 'ready' : 'unconfigured', canInstall: true }),
		installFfmpeg: () => { installations += 1; installed = true; return { state: 'ready' }; },
	});
	const owner = {};
	await availability.check(owner, async () => installed ? { available: true } : missing);
	assert.equal(availability.getSnapshot().problem?.kind, 'missing-ffmpeg');
	assert.equal(availability.getSnapshot().problem?.canInstall, true);
	assert.equal(installations, 0, 'selection must never start installation');
	await availability.install();
	assert.equal(installations, 1);
	assert.equal(availability.getSnapshot().available, true);
	assert.equal(availability.getSnapshot().problem, null);
	availability.dispose();
});

test('configured but unsupported codecs preserve the exact missing component cause', async () => {
	const availability = createExportFormatAvailability({
		readFfmpegStatus: () => ({ state: 'ready', location: '/usr/bin/ffmpeg' }),
	});
	await availability.check({}, async () => ({
		...missing, reasonCode: 'unsupported-by-configured-ffmpeg', missingCapabilities: ['encoder:libvorbis'],
	}));
	assert.equal(availability.getSnapshot().problem?.kind, 'unavailable');
	assert.deepEqual(availability.getSnapshot().problem?.failure.missingCapabilities, ['encoder:libvorbis']);
	assert.equal(availability.getSnapshot().problem?.canInstall, false);
	availability.dispose();
});

test('capability bridge errors and unsupported settings never claim FFmpeg is missing', async () => {
	let statusReads = 0;
	const availability = createExportFormatAvailability({
		readFfmpegStatus: () => { statusReads += 1; return { state: 'unconfigured' }; },
	});
	await availability.check({}, () => { throw new Error('Invalid capability response'); });
	assert.equal(availability.getSnapshot().problem?.failure.cause, 'Invalid capability response');
	assert.equal(availability.getSnapshot().problem?.kind, 'unavailable');
	await availability.check({}, async () => ({ available: false, reasonCode: 'unsupported-settings' }));
	assert.equal(availability.getSnapshot().problem?.kind, 'unavailable');
	assert.equal(statusReads, 0);
	availability.dispose();
});

test('late checks and installations cannot overwrite a newer selection or closed dialog', async () => {
	let finishProbe: ((value: { available: boolean }) => void) | undefined;
	let finishInstall: ((value: unknown) => void) | undefined;
	const availability = createExportFormatAvailability({
		readFfmpegStatus: () => ({ state: 'unconfigured', canInstall: true }),
		installFfmpeg: () => new Promise(resolve => { finishInstall = resolve; }),
	});
	const first = availability.check({}, () => new Promise(resolve => { finishProbe = resolve; }));
	const owner = {};
	await availability.check(owner, async () => ({ available: true }));
	finishProbe?.({ available: false });
	await first;
	assert.equal(availability.getSnapshot().owner, owner);
	assert.equal(availability.getSnapshot().available, true);
	await availability.check({}, async () => missing);
	const install = availability.install();
	await availability.check(owner, async () => ({ available: true }));
	finishInstall?.({ state: 'ready' });
	await install;
	assert.equal(availability.getSnapshot().owner, owner);
	assert.equal(availability.getSnapshot().available, true);
	availability.dispose();
	assert.equal(availability.getSnapshot().problem, null);
});

test('failed installation reports its cause and allows retry without starting an export', async () => {
	const availability = createExportFormatAvailability({
		readFfmpegStatus: () => ({ state: 'unconfigured', canInstall: true }),
		installFfmpeg: () => ({ state: 'error', detail: 'Package manager is unavailable.', canInstall: true }),
	});
	await availability.check({}, async () => missing);
	await availability.install();
	assert.equal(availability.getSnapshot().installing, false);
	assert.equal(availability.getSnapshot().problem?.failure.cause, 'Package manager is unavailable.');
	availability.dismiss();
	assert.equal(availability.getSnapshot().problem, null);
	assert.equal(availability.getSnapshot().available, false);
	await availability.retry();
	assert.equal(availability.getSnapshot().problem?.kind, 'missing-ffmpeg');
	availability.dispose();
});

test('closing the export cancels pending selection custody', async () => {
	let finish: ((value: { available: boolean }) => void) | undefined;
	const availability = createExportFormatAvailability({});
	const pending = availability.check({}, () => new Promise(resolve => { finish = resolve; }));
	availability.reset();
	finish?.({ available: false });
	await pending;
	assert.equal(availability.getSnapshot().problem, null);
	assert.equal(availability.getSnapshot().owner, null);
	availability.dispose();
});
