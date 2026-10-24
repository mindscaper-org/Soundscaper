/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { scanEncodedAudioMarkers } from '../src/common/editor/encoded-audio-marker-scan.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

function latch(): { ready: Promise<void>; release: () => void } {
	let release = (): void => {}; const ready = new Promise<void>(resolve => { release = resolve; }); return { ready, release };
}

for (const rejectLate of [false, true]) test(`File Import Cancel retires the optional marker signature read (late failure=${String(rejectLate)})`, async () => {
	const entered = latch(), resume = latch(); let signatureReads = 0, decodes = 0;
	class PendingFile extends File {
		override slice(start?: number, end?: number, type?: string): Blob {
			const result = super.slice(start, end, type);
			// Attribution has three independent signature probes; the fourth is
			// the optional cue scanner immediately before native decoding.
			if (start === 0 && end === 12 && ++signatureReads === 4) {
				const read = result.arrayBuffer.bind(result);
				Object.defineProperty(result, 'arrayBuffer', { value: async () => {
					entered.release(); await resume.ready;
					if (rejectLate) throw new Error('The retired marker read failed.');
					return read();
				} });
			}
			return result;
		}
	}
	const fixture = await createTwoTrackFixture('a4-marker-cancel', new Map<string, Float32Array>(), 48_000);
	const engine = Object.assign(createMemoryEngine(), { async getAudioContext() { return { sampleRate: 48_000,
		createBuffer: (channels: number, frames: number, rate: number) => new MockAudioBuffer(channels, frames, rate) }; },
	async decodeAudioData() { decodes++; return new MockAudioBuffer(2, 4800, 48_000); } });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
		engine: engine as unknown as Options['engine'] });
	let pending: Promise<unknown> | undefined;
	try {
		await controller.ready;
		pending = controller.actions.project.importFiles([new PendingFile([Uint8Array.from(aacLcM4a48_000Fixture())], 'Pending.bin', { type: 'application/octet-stream' })]);
		await entered.ready; assert.equal(signatureReads, 4); assert.equal(decodes, 0);
		let settled = false; void pending.then(() => { settled = true; });
		assert.equal(controller.actions.project.cancelTask(), true);
		for (let turn = 0; turn < 30; turn++) await nextTurn();
		assert.equal(settled, true, 'Cancel must release import before the marker read settles');
		assert.equal(controller.getSnapshot().importing, false);
		await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([new Float32Array(2400).fill(.125)], { sampleRate: 48_000 }))], 'Fresh.wav')]);
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.deepEqual(project.sources.map(source => source.name), ['Fresh.wav']);
		resume.release(); for (let turn = 0; turn < 30; turn++) await nextTurn();
		assert.deepEqual(controller.getSnapshot().project, project); assert.equal(decodes, 0);
	} finally { resume.release(); await pending?.catch(() => undefined); await controller.dispose(); }
});

for (const phase of ['signature', 'chunk', 'payload'] as const) test(`marker cancellation retires a pending ${phase} read without late traversal`, async () => {
	const bytes = Uint8Array.from(encodeWav([new Float32Array(8)], { sampleRate: 48_000 }));
	const entered = latch(), resume = latch(), abort = new AbortController(); let reads = 0;
	const operation = scanEncodedAudioMarkers({ size: bytes.length, slice(start: number, end: number) { return { async arrayBuffer() {
		reads++;
		if (phase === 'signature' && start === 0 || phase === 'chunk' && start === 12 || phase === 'payload' && start === 20) { entered.release(); await resume.ready; }
		return bytes.slice(start, end).buffer;
	} }; } }, abort.signal);
	let result: unknown = 'pending'; void operation.then(value => { result = value; }, (error: unknown) => { result = error; });
	try {
		await entered.ready; const reason = new DOMException('Import cancelled.', 'AbortError'); abort.abort(reason);
		for (let turn = 0; turn < 10; turn++) await nextTurn();
		assert.equal(result, reason); const retiredReads = reads;
		resume.release(); await assert.rejects(operation, (error: unknown) => error === reason);
		assert.equal(reads, retiredReads);
	} finally { resume.release(); await operation.catch(() => undefined); }
});
