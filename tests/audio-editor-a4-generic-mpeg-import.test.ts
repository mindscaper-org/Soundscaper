/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { crcOffsetMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';

for (const generic of [false, true]) test(`File Import preserves the MPEG programme when its file identity is generic=${String(generic)}`, async () => {
	const original = await crcOffsetMp3Fixture('unprotected');
	const file = new File([original], generic ? 'Recording.bin' : original.name, { type: generic ? 'application/octet-stream' : original.type });
	const { store } = await createTwoTrackFixture(`a4-generic-mpeg-${String(generic)}`, new Map<string, Float32Array>(), 48_000);
	let nativeCalls = 0;
	const engine = Object.assign(createMemoryEngine(), { decodeAudioData: () => { nativeCalls++; return Promise.resolve(new MockAudioBuffer(1, 6912, 48_000)); } });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: engine as unknown as Options['engine'], ffmpeg: { dispose() {} } as Options['ffmpeg'] });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async url => { assert.ok(url instanceof URL); return new Response(Uint8Array.from(await readFile(url))); };
	try {
		await controller.ready; await controller.actions.project.importFiles([file], { destination: 'timeline' });
		const project = controller.getSnapshot().project; assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1); assert.equal(project.sources[0]!.frameCount, 4800);
		assert.equal(nativeCalls, 0, 'The existing packet route owns MPEG gapless geometry regardless of filename.');
	} finally { globalThis.fetch = originalFetch; await controller.dispose(); }
});

test('generic MPEG sniffing skips bounded ID3 payloads and validates a matching footer', async () => {
	const original = await crcOffsetMp3Fixture('unprotected');
	const { inspectStreamedAudioImportFile } = await import('../src/common/editor/streamed-audio-content-admission.ts');
	const payload = new Uint8Array(12_345), header = Uint8Array.of(73, 68, 51, 4, 0, 16, 0, 0, payload.length >> 7, payload.length & 127);
	const footer = header.slice(); footer.set([51, 68, 73]);
	let largest = 0;
	class Measured extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		largest = Math.max(largest, end - start); return super.slice(start, end, type);
	} }
	const file = new Measured([header, payload, footer, original], 'Download.bin');
	assert.equal(await inspectStreamedAudioImportFile(file), true); assert.ok(largest <= 10);
	footer[9] = footer[9]! ^ 1;
	assert.equal(await inspectStreamedAudioImportFile(new File([header, payload, footer, original], file.name)), false);
	assert.equal(await inspectStreamedAudioImportFile(new File([header.subarray(0, 9)], file.name)), false);
});

test('generic MPEG sniffing preserves explicit identities, free-format and malformed/foreign bytes', async () => {
	const { inspectStreamedAudioImportFile } = await import('../src/common/editor/streamed-audio-content-admission.ts');
	const bytes = new Uint8Array(await (await crcOffsetMp3Fixture('unprotected')).arrayBuffer());
	for (const [name, type] of [['Recording.wav', ''], ['Recording.aiff', ''], ['Recording.bin', 'audio/aiff']]) {
		assert.equal(await inspectStreamedAudioImportFile(new File([bytes], name!, { type })), false);
	}
	assert.equal(await inspectStreamedAudioImportFile(new File([], 'Recording.mp3')), true, 'Existing named admission remains the decoder’s decision.');
	for (const [index, value] of [[1, 0xe9], [2, 0], [3, 2], [577, 0xe9], [578, 0x9c], [579, 0]]) {
		const changed = bytes.slice(); changed[index!] = value!;
		assert.equal(await inspectStreamedAudioImportFile(new File([changed], 'Recording.bin')), false);
	}
	assert.equal(await inspectStreamedAudioImportFile(new File([bytes.subarray(0, 580)], 'Short.bin')), false);
});

test('Cancel releases an outstanding generic identity range and retains its exact reason', { timeout: 2000 }, async () => {
	const { inspectStreamedAudioImportFile } = await import('../src/common/editor/streamed-audio-content-admission.ts');
	const original = await crcOffsetMp3Fixture('unprotected'), abort = new AbortController();
	let enter = (): void => {}; const entered = new Promise<void>(resolve => { enter = resolve; });
	let finish = (_bytes: ArrayBuffer): void => {};
	class Held extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		const blob = super.slice(start, end, type); blob.arrayBuffer = () => new Promise(resolve => { finish = resolve; enter(); }); return blob;
	} }
	const pending = inspectStreamedAudioImportFile(new Held([original], 'Recording.bin'), abort.signal);
	await entered; const reason = new DOMException('Retire generic import.', 'AbortError'); abort.abort(reason);
	await assert.rejects(pending, error => error === reason); finish(new ArrayBuffer(10));
});
