/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { crc32, decodePcmWithWavPack, encodePcmAdaptively, loadWavPackWasm, PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/index.js';

/** These fixtures exercise real worker checksums; encode/decode are outside their admitted route. */
class ChecksumOnlyCodec extends WavPackCodecClient {
	async encode(): Promise<never> { throw new Error('Encoding is outside this checksum fixture.'); }
	async decode(): Promise<never> { throw new Error('Decoding is outside this checksum fixture.'); }
}

async function rejectsWithIdentity(promise: Promise<unknown>, expected: unknown): Promise<void> {
	const result = await promise.then(() => ({ rejected: false as const }), (error: unknown) => ({ rejected: true as const, error }));
	assert.equal(result.rejected, true);
	if (result.rejected) assert.equal(Object.is(result.error, expected), true);
}

async function actualCodec() {
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	return {
		async encode(input: ArrayBuffer, options: Record<string, unknown>) { return encodePcmAdaptively(input, { ...options, runtime }); },
		async decode(input: ArrayBuffer, options: Record<string, unknown>) { return { payload: decodePcmWithWavPack(input, { ...options, runtime }) }; },
	};
}

function opaqueReason() {
	let traps = 0;
	const reason = new Proxy({}, {
		get() { traps += 1; throw new Error('Cancellation reason get.'); },
		has() { traps += 1; throw new Error('Cancellation reason has.'); },
		getPrototypeOf() { traps += 1; throw new Error('Cancellation reason prototype.'); },
	});
	return { reason, assertUnreflected: () => { assert.equal(traps, 0); } };
}

const options = { frames: 1_024, channelCount: 1, sampleRate: 48_000, priority: 'migration',
	allowRawOnFailure: true, requireWavPack: true };

for (const kind of ['custom', 'opaque', 'native-abort'] as const) test(`required real WavPack ${kind} cancellation keeps reason identity and the next encode healthy`, { timeout: 15_000 }, async t => {
	const codec = await actualCodec(), stop = new AbortController(), opaque = opaqueReason();
	const reason = kind === 'custom' ? Object.freeze({ cancel: 'only this encode' })
		: kind === 'opaque' ? opaque.reason : new DOMException('Only this encode was cancelled.', 'AbortError');
	const decode = codec.decode.bind(codec);
	let first = true, encodes = 0;
	const encode = codec.encode.bind(codec);
	t.mock.method(codec, 'encode', (...args: Parameters<typeof encode>) => { encodes += 1; return encode(...args); });
	t.mock.method(codec, 'decode', async (...args: Parameters<typeof decode>) => {
		const result = await decode(...args);
		if (first) { first = false; stop.abort(reason); }
		return result;
	});
	const pcm = new PcmRepository({ codec }), input = new Float32Array(1_024).fill(0.25).buffer;
	await rejectsWithIdentity(pcm.encode(input, { ...options, signal: stop.signal }), reason);
	opaque.assertUnreflected();
	const next = await pcm.encode(input, options);
	assert.equal(next.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.equal(encodes, 2, 'The cancelled verification must not open the codec circuit.');
	const restored = await pcm.decodeRecord({ ...next, index: 0, frames: 1_024 }, { channelCount: 1, sampleRate: 48_000 });
	assert.deepEqual(new Uint8Array(restored.channels[0]!.buffer), new Uint8Array(input));
	opaque.assertUnreflected();
});

test('an unrelated real encode verification failure still opens the circuit when cancellation races it', { timeout: 15_000 }, async t => {
	const codec = await actualCodec(), stop = new AbortController();
	const reason = Object.freeze({ cancel: 'different failure' }), failure = new Error('Actual verification reader failed.');
	const decode = codec.decode.bind(codec);
	let encodes = 0;
	const encode = codec.encode.bind(codec);
	t.mock.method(codec, 'encode', (...args: Parameters<typeof encode>) => { encodes += 1; return encode(...args); });
	t.mock.method(codec, 'decode', async (...args: Parameters<typeof decode>) => {
		await decode(...args); stop.abort(reason); throw failure;
	});
	const pcm = new PcmRepository({ codec }), input = new Float32Array(1_024).fill(0.25).buffer;
	await rejectsWithIdentity(pcm.encode(input, { ...options, signal: stop.signal }), failure);
	await assert.rejects(pcm.encode(input, options), /disabled for this session/u);
	assert.equal(encodes, 1);
});

test('exact opaque cancellation after an actual checksum reply does not disable later worker checksums', { timeout: 15_000 }, async t => {
	let receive!: (event: { data: unknown }) => void, reply!: (event: { data: unknown }) => void;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	Reflect.set(globalThis, 'self', { addEventListener(_type: string, listener: typeof receive) { receive = listener; },
		postMessage(value: unknown, transfer: ArrayBuffer[]) { reply({ data: structuredClone(value, { transfer }) }); } });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); });
	await import('../src/common/editor/wavpack/worker.js');
	const client = new ChecksumOnlyCodec({ workerFactory: () => ({
		addEventListener(type: string, listener: typeof reply) { if (type === 'message') reply = listener; },
		postMessage(value: unknown, transfer: ArrayBuffer[]) { receive({ data: structuredClone(value, { transfer }) }); }, terminate() {},
	}) });
	t.after(() => { client.close(); });
	const stop = new AbortController(), opaque = opaqueReason(), checksum = client.checksum.bind(client);
	let checks = 0;
	t.mock.method(client, 'checksum', async (...args: Parameters<typeof checksum>) => {
		const result = await checksum(...args);
		checks += 1; if (checks === 1) stop.abort(opaque.reason);
		return result;
	});
	const pcm = new PcmRepository({ codec: client }); pcm.setOptimizationMode('speed');
	const input = new Float32Array(2_048).fill(0.25).buffer;
	const request = { frames: 2_048, channelCount: 1, sampleRate: 48_000, priority: 'foreground', allowRawOnFailure: true };
	await rejectsWithIdentity(pcm.encode(input, { ...request, signal: stop.signal }), opaque.reason);
	opaque.assertUnreflected();
	const next = await pcm.encode(input, request);
	assert.equal(checks, 2, 'Cancellation after checksum completion must not mark the checksum worker unavailable.');
	assert.notEqual(next.payload, input); assert.deepEqual(new Uint8Array(next.payload), new Uint8Array(input));
	assert.equal(next.pcmCrc32, crc32(input)); opaque.assertUnreflected();
});
