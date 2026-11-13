/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';

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

test('untrusted FFmpeg status and status-read failures never fabricate an installation path', async () => {
	for (const status of [null, [], false, 'ready', {}, { state: 'unconfigured', canInstall: 1 },
		{ state: 'unconfigured', canInstall: true, location: '/usr/bin/ffmpeg' }]) {
		let installations = 0;
		const availability = createExportFormatAvailability({
			readFfmpegStatus: () => status,
			installFfmpeg: () => { installations += 1; return { state: 'ready' }; },
		});
		try {
			await availability.check({}, async () => missing);
			assert.equal(availability.getSnapshot().problem?.canInstall, false);
			await availability.install(); assert.equal(installations, 0);
		} finally { availability.dispose(); }
	}
	const availability = createExportFormatAvailability({ readFfmpegStatus: () => { throw new Error('status read refused'); } });
	try {
		await availability.check({}, async () => missing);
		assert.equal(availability.getSnapshot().problem?.kind, 'unavailable');
		assert.equal(availability.getSnapshot().problem?.failure.cause, 'status read refused');
	} finally { availability.dispose(); }
});

test('a pending FFmpeg status response cannot publish into a newer selected format', async () => {
	const status = deferred<unknown>();
	const availability = createExportFormatAvailability({ readFfmpegStatus: () => status.promise });
	try {
		const firstOwner = {}, secondOwner = {};
		const pending = availability.check(firstOwner, async () => missing);
		await Promise.resolve();
		await availability.check(secondOwner, async () => ({ available: true }));
		status.resolve({ state: 'unconfigured', canInstall: true });
		await pending;
		assert.equal(availability.getSnapshot().owner, secondOwner);
		assert.equal(availability.getSnapshot().available, true);
		assert.equal(availability.getSnapshot().problem, null);
	} finally { status.resolve(null); availability.dispose(); }
});

test('repeat Install cannot duplicate a pending installation and stale rejection cannot replace a new format', async () => {
	const installation = deferred<unknown>(); let installations = 0;
	const availability = createExportFormatAvailability({
		readFfmpegStatus: () => ({ state: 'unconfigured', canInstall: true }),
		installFfmpeg: () => { installations += 1; return installation.promise; },
	});
	try {
		await availability.check({}, async () => missing);
		const first = availability.install();
		await availability.install(); assert.equal(installations, 1);
		const secondOwner = {};
		await availability.check(secondOwner, async () => ({ available: true }));
		installation.reject('installation was refused'); await first;
		assert.equal(availability.getSnapshot().owner, secondOwner);
		assert.equal(availability.getSnapshot().available, true);
		assert.equal(availability.getSnapshot().problem, null);
	} finally { installation.resolve(null); availability.dispose(); }
});

test('capability errors retain a bounded exact cause for Error and non-Error bridge failures', async () => {
	for (const cause of [new Error('x'.repeat(4096)), 'x'.repeat(4096)]) {
		const availability = createExportFormatAvailability({});
		try {
			await availability.check({}, () => { throw cause; });
			assert.equal(availability.getSnapshot().problem?.failure.reasonCode, 'probe-failed');
			assert.equal(availability.getSnapshot().problem?.failure.cause, 'x'.repeat(2048));
			assert.equal(availability.getSnapshot().problem?.kind, 'unavailable');
		} finally { availability.dispose(); }
	}
});
