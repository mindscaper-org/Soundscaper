/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { InitialAacSbrError, initialAacSbrError } from '../src/common/editor/aac-initial-profile-error.ts';
import { createNativeStreamedAacImport } from '../src/common/editor/browser-native-streamed-aac-import.ts';
import { importStreamedAudioFile, NATIVE_AAC_IMPORT_FALLBACK } from '../src/common/editor/controller/import/internal/streamed-audio-import-service.ts';
import { aacLcM4a44_100Fixture } from './helpers/os-audio-codec-fixtures.ts';

const config: AudioDecoderConfig = { codec: 'mp4a.40.2', sampleRate: 24_000, numberOfChannels: 2, description: Uint8Array.of(19, 16) };
test('only a validated ordinary two-byte LC configuration can identify initial doubled-rate SBR/PS', () => {
	assert.ok(initialAacSbrError(config, { sampleRate: 48_000, numberOfChannels: 2 }) instanceof InitialAacSbrError);
	assert.ok(initialAacSbrError({ ...config, numberOfChannels: 1, description: Uint8Array.of(19, 8) }, { sampleRate: 48_000, numberOfChannels: 2 }));
	for (const changed of [{ ...config, description: undefined }, { ...config, description: Uint8Array.of(19, 17) },
		{ ...config, sampleRate: 48_000 }, { ...config, codec: 'mp4a.40.5' }, { ...config, description: Uint8Array.of(19, 16, 0) }]) {
		assert.equal(initialAacSbrError(changed, { sampleRate: 48_000, numberOfChannels: 2 }), null);
	}
	assert.equal(initialAacSbrError(config, { sampleRate: 44_100, numberOfChannels: 2 }), null);
	assert.equal(initialAacSbrError(config, { sampleRate: 48_000, numberOfChannels: 6 }), null);
});

for (const priorOutput of [false, true]) test(`AAC initial-profile refusal cannot identify a mismatch after accepted output=${String(priorOutput)}`, async () => {
	let callbacks: AudioDecoderInit, closed = 0, released = 0;
	const session = createNativeStreamedAacImport({ config, packets: async function* () {
		yield { data: Uint8Array.of(1), type: 'key', timestamp: 0, duration: 1024 / 24_000, byteLength: 1 };
	}, createChunk: () => ({} as EncodedAudioChunk), createDecoder(init) {
		callbacks = init; return { decodeQueueSize: 0, configure() {}, addEventListener() {}, removeEventListener() {},
			decode() { queueMicrotask(() => {
				if (priorOutput) callbacks.output({ sampleRate: 24_000 } as AudioData);
				callbacks.output({ sampleRate: 48_000 } as AudioData);
			}); }, async flush() {}, close() { closed++; } };
	}, wrapSample: data => ({ timestamp: 0, duration: 1024 / data.sampleRate, sampleRate: data.sampleRate,
		numberOfFrames: 1024, numberOfChannels: 2, copyTo() {}, close() { released++; } }) });
	await assert.rejects(session.samples().next(), error => error instanceof RangeError && (error instanceof InitialAacSbrError) === !priorOutput);
	assert.equal(closed, 1); assert.equal(released, priorOutput ? 2 : 1);
});

for (const failure of ['initial', 'named', 'storage', 'abort', 'stale'] as const) test(`opaque AAC fallback preserves ${failure} ownership and rollback`, async () => {
	const originalDecoder = globalThis.AudioDecoder, abort = new AbortController();
	globalThis.AudioDecoder = class { static async isConfigSupported() { return { supported: true }; } } as unknown as typeof AudioDecoder;
	const reason = failure === 'storage' ? new RangeError('Storage quota') : new InitialAacSbrError();
	const stale = new Error('The project changed.'), cancelled = new DOMException('Cancel opaque AAC.', 'AbortError');
	let rolledBack = false;
	const importer: Parameters<typeof importStreamedAudioFile>[4] = async () => {
		rolledBack = true; if (failure === 'abort') abort.abort(cancelled); throw reason;
	};
	const file = new File([Uint8Array.from(aacLcM4a44_100Fixture())], failure === 'named' ? 'Recording.m4a' : 'Recording.bin');
	try {
		const pending = importStreamedAudioFile(file, { signal: abort.signal }, { async decode() { throw new Error('No native decode is owned by the stream attempt.'); } }, {}, importer, () => { if (rolledBack && failure === 'stale') throw stale; });
		if (failure === 'initial') assert.equal(await pending, NATIVE_AAC_IMPORT_FALLBACK);
		else await assert.rejects(pending, error => error === (failure === 'abort' ? cancelled : failure === 'stale' ? stale : reason));
		assert.equal(rolledBack, true); assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
	} finally { globalThis.AudioDecoder = originalDecoder; }
});
