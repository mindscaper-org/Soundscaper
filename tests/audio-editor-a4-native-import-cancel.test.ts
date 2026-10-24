/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { aacLcAdtsPceFixture } from './helpers/os-audio-codec-fixtures.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/import/internal/standalone-audio-import-decoder.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';

function latch(): { ready: Promise<void>; release: () => void } {
	let release = (): void => {}; const ready = new Promise<void>(resolve => { release = resolve; }); return { ready, release };
}

for (const rejectLate of [false, true]) test(`File Import Cancel retires a pending native decode before fresh import (late failure=${String(rejectLate)})`, async () => {
	const entered = latch(), resume = latch(); let fallbacks = 0;
	const fixture = await createTwoTrackFixture('a4-native-import-cancel', new Map<string, Float32Array>(), 48_000);
	const decoded = new MockAudioBuffer(2, 4800, 48_000); decoded.getChannelData(0).fill(.25); decoded.getChannelData(1).fill(-.125);
	const engine = Object.assign(createMemoryEngine(), { async getAudioContext() { return { sampleRate: 48_000,
		createBuffer: (channels: number, frames: number, rate: number) => new MockAudioBuffer(channels, frames, rate) }; },
	async decodeAudioData() { entered.release(); await resume.ready; if (rejectLate) throw new DOMException('Old decode failed.', 'EncodingError'); return decoded; } });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const codec: Pick<NonNullable<Options['ffmpeg']>, 'decode' | 'dispose'> = {
		async decode() { fallbacks++; throw new Error('A retired native decoder must not start codec fallback.'); }, dispose() {},
	};
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
		engine: engine as unknown as Options['engine'], ffmpeg: codec as Options['ffmpeg'] });
	let pending: Promise<unknown> | undefined;
	try {
		await controller.ready; pending = controller.actions.project.importFiles([new File([Uint8Array.from(aacLcAdtsPceFixture(false))], 'Pending.bin', { type: 'application/octet-stream' })]);
		await Promise.race([entered.ready, pending.then(() => { throw new Error('Import completed before reaching its held native decoder.'); })]); assert.equal(controller.getSnapshot().importing, true);
		let settled = false; void pending.then(() => { settled = true; });
		assert.equal(controller.actions.project.cancelTask(), true);
		for (let turn = 0; turn < 30; turn++) await nextTurn();
		assert.equal(settled, true, 'Cancel must release the import before the native decode settles');
		assert.equal(controller.getSnapshot().importing, false);
		const fresh = Uint8Array.from(encodeWav([new Float32Array(2400).fill(.125)], { sampleRate: 48_000 }));
		await controller.actions.project.importFiles([new File([fresh], 'Fresh.wav')]);
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.deepEqual(project.sources.map(source => source.name), ['Fresh.wav']);
		resume.release(); for (let turn = 0; turn < 30; turn++) await nextTurn();
		assert.deepEqual(controller.getSnapshot().project, project); assert.equal(fallbacks, 0);
	} finally { resume.release(); await pending?.catch(() => undefined); await controller.dispose(); }
});

for (const phase of ['context', 'read', 'native', 'fallback', 'desktop', 'buffer', 'metadata'] as const) {
	test(`native import cancellation retires the ${phase} await without starting later decoder work`, async () => {
		const entered = latch(), resume = latch(), abort = new AbortController(), calls: string[] = [];
		const value = { sampleRate: 48_000 }, channels = [new Float32Array(8)];
		const gate = async (current: string): Promise<void> => {
			calls.push(current); if (phase === current) { entered.release(); await resume.ready; }
		};
		const operation = decodeStandaloneAudioForImport({
			file: { async arrayBuffer() { await gate(phase === 'metadata' ? 'metadata' : 'read'); return new ArrayBuffer(8); } },
			codecRuntime: ['desktop', 'buffer', 'metadata'].includes(phase) ? { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } : {},
			sampleRate: 48_000, signal: abort.signal,
			async getAudioContext() { await gate('context'); return {}; },
			async decodeWithWebAudio() { await gate('native'); if (phase === 'fallback') throw new Error('Use codec fallback.'); return value; },
			async decodeWithCodec(_file, settings) { assert.equal(settings.signal, abort.signal); await gate(phase === 'desktop' ? 'desktop' : 'fallback'); return { channels, sampleRate: 48_000 }; },
			async bufferFromChannels() { await gate('buffer'); return value; },
			inspectEncodedSampleRate: () => 48_000, inspectDecodedSampleRate: () => 48_000,
		});
		let result: unknown = 'pending'; void operation.then(() => { result = 'success'; }, (error: unknown) => { result = error; });
		try {
			await entered.ready; const reason = new DOMException('Audio import cancelled.', 'AbortError'); abort.abort(reason);
			for (let turn = 0; turn < 30; turn++) await nextTurn();
			assert.equal(result, reason); const retiredCalls = [...calls];
			resume.release(); await assert.rejects(operation, (error: unknown) => error === reason);
			for (let turn = 0; turn < 30; turn++) await nextTurn();
			assert.deepEqual(calls, retiredCalls, 'late completion cannot acquire a context, decode or inspect again');
		} finally { resume.release(); await operation.catch(() => undefined); }
	});
}
