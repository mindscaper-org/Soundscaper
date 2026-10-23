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
