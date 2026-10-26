/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, Input, OGG } from 'mediabunny';
import { nativeSurroundOpusAdmission, assertNativeSurroundOpusGeometry } from '../src/common/editor/controller/import/internal/native-surround-opus-admission.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';
import { ordinaryOggOpusFixture, surroundOggOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

function trackedInput(): Readonly<{ createInput: (file: Blob) => Input; disposed: () => number }> {
	let disposed = 0;
	return { disposed: () => disposed, createInput(file) {
		const input = new Input({ source: new BlobSource(file), formats: [OGG] });
		const dispose = input.dispose.bind(input);
		input.dispose = () => { disposed++; dispose(); };
		return input;
	} };
}

test('the optional native codec admission stays with its lazy import owner', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/native-surround-opus-admission.ts'), 'editor-import-admission');
});

test('the authentic six-channel first-packet native EncodingError selects a bounded fallback', async () => {
	const tracked = trackedInput(); let probes = 0;
	const admission = await nativeSurroundOpusAdmission(await surroundOggOpusFixture(), { ...tracked,
		async readFirstSample(track) {
			assert.equal(await track.getNumberOfChannels(), 6); probes++;
			throw new DOMException('Decode error', 'EncodingError');
		},
	});
	assert.deepEqual(admission, { sampleRate: 48_000, channelCount: 6, frameCount: 3840 });
	assert.equal(probes, 1); assert.equal(tracked.disposed(), 1);
	assert.doesNotThrow(() => assertNativeSurroundOpusGeometry({ sampleRate: 48_000, numberOfChannels: 6, length: 3840 }, admission));
	for (const decoded of [{ sampleRate: 44_100, numberOfChannels: 6, length: 3840 },
		{ sampleRate: 48_000, numberOfChannels: 2, length: 3840 }, { sampleRate: 48_000, numberOfChannels: 6, length: 3841 }]) {
		assert.throws(() => assertNativeSurroundOpusGeometry(decoded, admission), /geometry/u);
	}
});

test('a healthy incremental surround sample stays on the existing streaming route and is released', async () => {
	const tracked = trackedInput(); let closed = 0;
	assert.equal(await nativeSurroundOpusAdmission(await surroundOggOpusFixture(), { ...tracked,
		readFirstSample: () => Promise.resolve({ close() { closed++; } }),
	}), null);
	assert.equal(closed, 1); assert.equal(tracked.disposed(), 1);
});

test('ordinary mono Opus never runs the compatibility probe', async () => {
	assert.equal(await nativeSurroundOpusAdmission(await ordinaryOggOpusFixture(), {
		createInput: () => { throw new Error('Mono must not open a second metadata reader.'); },
		readFirstSample: () => { throw new Error('Mono should use its normal decoder.'); },
	}), null);
});

for (const error of [new DOMException('Invalid packet', 'DataError'), new DOMException('Quota', 'QuotaExceededError'),
	new Error('Device unavailable'), { name: 'EncodingError', message: 'Non-native failure' }]) {
	test(`the first-packet ${error.name} failure remains a failure`, async () => {
		const tracked = trackedInput();
		await assert.rejects(nativeSurroundOpusAdmission(await surroundOggOpusFixture(), { ...tracked,
			readFirstSample: () => Promise.reject(error),
		}), value => value === error);
		assert.equal(tracked.disposed(), 1);
	});
}

test('Cancel retires a pending first sample promptly, then releases an obsolete late sample', { timeout: 2000 }, async () => {
	const tracked = trackedInput(), abort = new AbortController();
	const pending: { release: ((sample: { close(): void }) => void) | null } = { release: null };
	let entered: (() => void) | null = null, closed = 0;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const operation = nativeSurroundOpusAdmission(await surroundOggOpusFixture(), { ...tracked, signal: abort.signal,
		readFirstSample: () => new Promise(resolve => { pending.release = resolve; entered?.(); }),
	});
	await started; abort.abort();
	await assert.rejects(operation, { name: 'AbortError' });
	assert.equal(tracked.disposed(), 1);
	assert.ok(pending.release); pending.release({ close() { closed++; } });
	await Promise.resolve(); assert.equal(closed, 1);
});

test('encoded and declared decoded size limits leave larger files on the bounded streaming route', async () => {
	assert.equal(await nativeSurroundOpusAdmission(new Blob([new ArrayBuffer(32 * 1024 ** 2 + 1)]), {
		createInput: () => { throw new Error('An oversized file must not be opened.'); },
	}), null);
	const large = await surroundOggOpusFixture(1500);
	assert.ok(large.size < 32 * 1024 ** 2);
	assert.equal(await nativeSurroundOpusAdmission(large, {
		readFirstSample: () => { throw new Error('Declared oversized PCM must not be probed.'); },
	}), null);
});

test('an understated final granule cannot hide an oversized native allocation', async () => {
	const bytes = new Uint8Array(await (await surroundOggOpusFixture(1500)).arrayBuffer());
	const endPageOffset = Buffer.from(bytes).lastIndexOf('OggS'); assert.ok(endPageOffset > 0);
	const page = bytes.subarray(endPageOffset), view = new DataView(page.buffer, page.byteOffset, page.byteLength);
	view.setBigUint64(6, 3840n, true); view.setUint32(22, oggPageCrc(page), true);
	let probes = 0;
	assert.equal(await nativeSurroundOpusAdmission(new File([bytes], 'Understated.ogg'), {
		readFirstSample: () => { probes++; return Promise.reject(new DOMException('Decode error', 'EncodingError')); },
	}), null);
	assert.equal(probes, 1);
});
