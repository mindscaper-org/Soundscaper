/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { ExternalFfmpegRuntimeAdmission } from '../desktop/external-ffmpeg-preference-service.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

function fixture() {
	const ffmpegPath = '/tools/ffmpeg', ffprobePath = '/tools/ffprobe';
	const ffmpegSha256 = '1'.repeat(64), ffprobeSha256 = '2'.repeat(64);
	let admission: ExternalFfmpegRuntimeAdmission | null = {
		executablePath: ffmpegPath, version: '9.0.1', capabilityGeneration: '4'.repeat(64),
		identity: { version: '9.0.1', ffmpegSha256, ffprobeSha256, ffprobePath,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({ ffmpegPath, ffprobePath, ffmpegSha256, ffprobeSha256 }) },
		capabilities: { encoders: ['libopus', 'pcm_f32le'], decoders: ['pcm_f32le', 'opus'],
			muxers: ['opus', 'wav'], demuxers: ['f32le', 'ogg'], filters: ['aresample'] },
	};
	const firstDone = deferred<void>();
	let starts = 0;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: '/private/codecs',
		externalFfmpegPreferences: { admission: () => admission,
			invalidateAdmission: () => Promise.reject(new Error('No invalidation expected')) },
		createExternalRunner: () => ({ execute: async () => {
			starts += 1;
			if (starts === 1) await firstDone.promise;
			return { status: 'executed', output: Uint8Array.of(1, 2, 3), log: '' };
		} }),
	});
	const request: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'opus', input: new Uint8Array(8), sampleRate: 48_000,
		channelCount: 2, settings: { bitrateKbps: 128, vbrMode: 1 }, maximumOutputBytes: 1024,
	};
	return { execute: (signal = new AbortController().signal) => service.execute(request, { signal }),
		starts: () => starts, release: () => { firstDone.resolve(); }, revoke: () => { admission = null; } };
}

test('external codec jobs from separate requests share a queue through native cleanup', async () => {
	const runtime = fixture();
	const first = runtime.execute();
	await waitFor(() => runtime.starts() === 1, 'first external codec job');
	const second = runtime.execute();
	const results = Promise.allSettled([first, second]);
	assert.equal(await remainsPending(second), true);
	assert.equal(runtime.starts(), 1);
	runtime.release();
	assert.deepEqual((await results).map(({ status }) => status), ['fulfilled', 'fulfilled']);
	assert.equal(runtime.starts(), 2);
});

test('a cancelled external codec waiter never constructs its runner', async () => {
	const runtime = fixture();
	const first = runtime.execute();
	await waitFor(() => runtime.starts() === 1, 'first external codec job');
	const controller = new AbortController();
	const second = runtime.execute(controller.signal);
	const cancelled = assert.rejects(second, /cancel/iu);
	assert.equal(await remainsPending(second), true);
	controller.abort(new DOMException('Queued encode cancelled', 'AbortError'));
	await cancelled;
	assert.equal(runtime.starts(), 1);
	runtime.release();
	await first;
});

test('queued external codec jobs revalidate the selected executable admission before starting', async () => {
	const runtime = fixture();
	const first = runtime.execute();
	await waitFor(() => runtime.starts() === 1, 'first external codec job');
	const second = runtime.execute();
	const rejected = assert.rejects(second, (error: unknown) => {
		assert.equal((error as { reason?: unknown }).reason, 'security-failed');
		return true;
	});
	assert.equal(await remainsPending(second), true);
	runtime.revoke();
	runtime.release();
	await first;
	await rejected;
	assert.equal(runtime.starts(), 1);
});
