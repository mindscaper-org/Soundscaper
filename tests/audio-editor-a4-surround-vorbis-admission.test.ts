/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { nativeContainerAudioAdmission, normalizeNativeContainerAudio, assertNativeContainerAudioGeometry, isNativeContainerAudioView } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { admitsNativeSurroundVorbisBackend, nativeSurroundVorbisAdmission } from '../src/common/editor/controller/import/internal/native-surround-vorbis-admission.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';
import { surroundVorbisFixture, surroundVorbisReference } from './helpers/surround-vorbis-fixture.ts';
import { prepareStreamedAudioImport, type PreparedStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

const WEBKIT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';

async function withBackend<Value>(userAgent: string, operation: () => Promise<Value>): Promise<Value> {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
	try { return await operation();
	} finally {
		if (previous) Object.defineProperty(globalThis, 'navigator', previous);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

test('native compatibility admission keeps supported surround Vorbis off the stalled packet decoder', async () => withBackend(WEBKIT, async () => {
		assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/native-surround-vorbis-admission.ts'), 'editor-import-admission');
		const admission = await nativeContainerAudioAdmission(surroundVorbisFixture(6), { nativeSampleRate() { throw new Error('Use the source clock.'); } });
		assert.ok(admission); assert.equal(admission.channelCount, 6); assert.equal(admission.sampleRate, 48_000); assert.equal(admission.frameCount, 4800);
		assert.equal(admission.decodeSampleRate, 48_000);
		assert.equal(await nativeContainerAudioAdmission(surroundVorbisFixture(2), { nativeSampleRate: () => 44_100 }), null);
		assert.equal(await nativeContainerAudioAdmission(surroundVorbisFixture(6), { nativeSampleRate: () => 48_000,
			codecRuntime: { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true } }), null);
}));

test('other backends retain their existing packet decoder admission', async () => {
	for (const userAgent of [WEBKIT.replace('Version/18.4', 'Chrome/130.0.0.0'),
		'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
		WEBKIT.replace('Macintosh', 'iPhone'), '', 'AppleWebKit/605.1.15 Safari/605.1.15']) {
		assert.equal(admitsNativeSurroundVorbisBackend(userAgent), false);
		await withBackend(userAgent, async () => { assert.equal(await nativeSurroundVorbisAdmission(surroundVorbisFixture(6)), null); });
	}
});

test('the native final-frame view copies only granule-authoritative samples without a second full PCM allocation', async () => withBackend(WEBKIT, async () => {
	const admission = await nativeSurroundVorbisAdmission(surroundVorbisFixture(6)); assert.ok(admission);
	const channels = surroundVorbisReference().map(channel => { const result = new Float32Array(4801); result.set(channel); result[4800] = .7; return result; });
	const native: AudioBuffer = {
		length: 4801, numberOfChannels: 6, sampleRate: 48_000, duration: 4801 / 48_000,
		getChannelData: channel => channels[channel]!,
		copyFromChannel(destination, channel, start = 0) { destination.set(channels[channel]!.subarray(start, start + destination.length)); },
		copyToChannel(source, channel, start = 0) { channels[channel]!.set(source, start); },
	};
	const view = normalizeNativeContainerAudio(native, admission);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(native), false);
	assert.equal(view.length, 4800); assert.equal(view.duration, .1); assert.ok(view.getChannelData(5).buffer === channels[5]!.buffer);
	assertPcmSamplesEqual(view.getChannelData(5), channels[5]!.subarray(0, 4800));
	assert.doesNotThrow(() => assertNativeContainerAudioGeometry(view, admission));
	const target = new Float32Array(3).fill(-99); view.copyFromChannel(target, 5, 4799);
	assert.equal(target[0], channels[5]![4799]); assert.deepEqual([...target.subarray(1)], [-99, -99]);
	view.copyToChannel(Float32Array.of(.1, .2), 5, 4799); assert.equal(channels[5]![4800], Math.fround(.7));
	assert.ok(normalizeNativeContainerAudio(native, null) === native);
	for (const changed of [{ ...native, length: 4802 }, { ...native, length: 4799 }, { ...native, sampleRate: 44_100 }, { ...native, numberOfChannels: 2 }]) {
		assert.throws(() => assertNativeContainerAudioGeometry(normalizeNativeContainerAudio(changed, admission), admission), /geometry/u);
	}
}));

async function changedPage(index: number, change: (page: Uint8Array<ArrayBuffer>) => void, checksum = true): Promise<File> {
	const original = surroundVorbisFixture(6), bytes = new Uint8Array(await original.arrayBuffer());
	let offset = 0;
	for (let current = 0; offset < bytes.length; current++) {
		const laces = bytes.subarray(offset + 27, offset + 27 + bytes[offset + 26]!);
		const size = 27 + laces.length + laces.reduce((sum, byte) => sum + byte, 0);
		if (current === index) {
			const page = bytes.subarray(offset, offset + size); change(page);
			if (checksum) new DataView(page.buffer, page.byteOffset, page.byteLength).setUint32(22, oggPageCrc(page), true);
			return new File([bytes], original.name, { type: original.type });
		}
		offset += size;
	}
	throw new Error('Fixture page does not exist.');
}

test('foreign, truncated, nonzero-origin and oversized source declarations stay outside native admission', async () => withBackend(WEBKIT, async () => {
	const original = surroundVorbisFixture(6);
	const variants = [new File([original, original], 'Chained.ogg'), original.slice(0, original.size - 1),
		await changedPage(0, page => { page[39] = 9; }),
		await changedPage(2, page => { new DataView(page.buffer, page.byteOffset).setBigUint64(6, 1601n, true); }),
		await changedPage(3, page => { page[14] = page[14]! ^ 1; }),
		await changedPage(6, page => { new DataView(page.buffer, page.byteOffset).setBigUint64(6, 1n << 40n, true); })];
	for (const file of variants) assert.equal(await nativeSurroundVorbisAdmission(file), null);
	class TooLarge extends Blob { override get size(): number { return 32 * 1024 ** 2 + 1; } }
	assert.equal(await nativeSurroundVorbisAdmission(new TooLarge()), null);
	await assert.rejects(nativeSurroundVorbisAdmission(await changedPage(6, page => { page[22] = page[22]! ^ 1; }, false)), /checksum/u);
}));

test('cancellation retires held physical or demux reads and a fresh source can retry', async () => withBackend(WEBKIT, async () => {
	for (const phase of ['header', 'demux']) {
		const abort = new AbortController(); const reason = new DOMException('Cancel Vorbis import', 'AbortError');
		let release: ((buffer: ArrayBuffer) => void) | undefined, started: (() => void) | undefined;
		const opened = new Promise<void>(resolve => { started = resolve; });
		class Held extends File { override slice(start = 0, end = this.size, type = ''): Blob {
			const part = super.slice(start, end, type);
			if (!release && (phase === 'header' || end - start > 300)) part.arrayBuffer = () => {
				started?.(); return new Promise<ArrayBuffer>(resolve => { release = resolve; });
			};
			return part;
		} }
		const file = surroundVorbisFixture(6), pending = nativeSurroundVorbisAdmission(new Held([file], file.name), abort.signal);
		await opened; abort.abort(reason); await assert.rejects(pending, error => error === reason);
		release?.(await file.arrayBuffer());
		assert.ok(await nativeSurroundVorbisAdmission(file));
	}
}));


test('a native WebKit surround packet source outside whole-file admission refuses before opening its stalled decoder', async () => withBackend(WEBKIT, async () => {
	const previous = globalThis.AudioDecoder;
	let opened = 0, prepared: PreparedStreamedAudioImport | undefined;
	class AdvertisedDecoder {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		constructor() { opened++; throw new Error('The native surround decoder must not be opened.'); }
	}
	globalThis.AudioDecoder = AdvertisedDecoder as unknown as typeof AudioDecoder;
	try {
		await assert.rejects(async () => { prepared = await prepareStreamedAudioImport(surroundVorbisFixture(6)); },
			/cannot import this surround Vorbis source/u);
		assert.equal(opened, 0);
	} finally { prepared?.dispose(); globalThis.AudioDecoder = previous; }
}));
