/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { editedM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

async function withNativeCapability(body: () => Promise<void>): Promise<void> {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioDecoder');
	Object.defineProperty(globalThis, 'AudioDecoder', { configurable: true, value: class {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
	} });
	try { await body(); } finally {
		if (previous) Object.defineProperty(globalThis, 'AudioDecoder', previous); else Reflect.deleteProperty(globalThis, 'AudioDecoder');
	}
}

for (const mode of ['none', 'trim', 'offset', 'empty-first', 'version1'] as const) test(`AAC import respects its ${mode} presentation duration`, async () => withNativeCapability(async () => {
	const { file, durationSeconds } = await editedM4aFixture(mode);
	const prepared = await prepareStreamedAudioImport(file);
	try {
		assert.equal(prepared.descriptor.sampleRate, 44_100);
		assert.equal(prepared.descriptor.frameCount, Math.round(durationSeconds * 44_100));
	} finally { prepared.dispose(); }
}));

for (const mode of ['multiple', 'rate', 'all-empty'] as const) test(`AAC ${mode} edits are refused before PCM rather than importing a different programme`, async () => withNativeCapability(async () => {
	const { file } = await editedM4aFixture(mode);
	await assert.rejects(prepareStreamedAudioImport(file), /edit.*(?:flatten|render)/iu);
}));

test('presentation inspection reads bounded headers and ignores another track identity', async () => {
	const { readIsoAudioPresentationEnd } = await import('../src/common/editor/iso-audio-presentation-edit.ts');
	const { file, durationSeconds } = await editedM4aFixture();
	const lengths: number[] = [];
	class BoundedFile extends Blob {
		override slice(start = 0, end = this.size, type = ''): Blob {
			lengths.push(end - start); return super.slice(start, end, type);
		}
	}
	const bounded = new BoundedFile([file]);
	assert.equal(await readIsoAudioPresentationEnd(bounded, 1), durationSeconds);
	assert.equal(await readIsoAudioPresentationEnd(bounded, 999), null);
	assert.ok(lengths.length > 1 && lengths.every(length => length <= 32));
	const abort = new AbortController(); abort.abort(new DOMException('Retired file import', 'AbortError'));
	await assert.rejects(readIsoAudioPresentationEnd(bounded, 1, abort.signal), { name: 'AbortError' });
});

for (const mode of ['multiple', 'rate', 'all-empty'] as const) test(`Freesound refuses ${mode} edits even when the native decoder would succeed`, async () => {
	const { prepareFreesoundUploadFile } = await import('../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts');
	const { file } = await editedM4aFixture(mode); let contexts = 0; let encodes = 0;
	await assert.rejects(prepareFreesoundUploadFile(file, undefined, {
		createDecodeContext: () => { contexts++; return { decodeAudioData: async () => decoded(3229, 44_100), close: async () => undefined }; },
		encode: () => { encodes++; return Uint8Array.of(1); },
	}), /edit.*(?:flatten|render)/iu);
	assert.equal(contexts, 0); assert.equal(encodes, 0);
});

test('Freesound never encodes extra native frames when its edited programme needs a decoder unavailable on this host', async () => {
	const { prepareFreesoundUploadFile } = await import('../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts');
	const { file } = await editedM4aFixture('empty-first'); let encodes = 0;
	await assert.rejects(prepareFreesoundUploadFile(file, undefined, {
		createDecodeContext: () => ({ decodeAudioData: async () => decoded(2048, 44_100), close: async () => undefined }),
		encode: () => { encodes++; return Uint8Array.of(1); },
	}), /cannot incrementally decode/u);
	assert.equal(encodes, 0);
});

test('Freesound keeps a native decoder that already returned the correct edited programme at its reconstructed clock', async () => {
	const { prepareFreesoundUploadFile } = await import('../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts');
	const { file, durationSeconds } = await editedM4aFixture('trim'); let closed = false; let encodes = 0;
	const frames = Math.round(durationSeconds * 48_000);
	await prepareFreesoundUploadFile(file, undefined, {
		createDecodeContext: () => ({ decodeAudioData: async () => decoded(frames, 48_000), close: async () => { closed = true; } }),
		encode: channels => { encodes++; assert.equal(channels[0]!.length, frames); return Uint8Array.of(1); },
	});
	assert.equal(closed, true); assert.equal(encodes, 1);
});

function decoded(length: number, sampleRate: number): AudioBuffer {
	return { length, sampleRate, numberOfChannels: 1, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
}
