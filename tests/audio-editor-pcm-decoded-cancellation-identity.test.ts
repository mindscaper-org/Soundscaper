/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { PcmStorageCorruptionError, PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/pcm.js';
import { encodePcmAdaptively, decodePcmWithWavPack } from '../src/common/editor/wavpack/operations.js';
import { loadWavPackWasm } from '../src/common/editor/wavpack/runtime.js';

async function outcome(promise: Promise<unknown>) {
	return promise.then(value => ({ rejected: false as const, value }), (error: unknown) => ({ rejected: true as const, error }));
}
function cancellation(kind: 'error' | 'opaque' | 'null' | 'nan') {
	let traps = 0;
	const opaque = new Proxy({}, { get() { traps += 1; throw new Error('Opaque get.'); },
		getPrototypeOf() { traps += 1; throw new Error('Opaque prototype.'); },
		has() { traps += 1; throw new Error('Opaque has.'); } });
	const reason: unknown = kind === 'error' ? new Error('Only this decode stopped.')
		: kind === 'opaque' ? opaque : kind === 'null' ? null : NaN;
	return { reason, assertUnreflected() { assert.equal(traps, 0); } };
}

async function fixture(stop: AbortController, reason: unknown, unrelated?: Error) {
	const bytes = await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '5197fb8fd8e6cbef210acad11eb2a9dd8395a519b5fd64ba14a1b4978041b0c5');
	const runtime = await loadWavPackWasm(bytes);
	const raw = Float32Array.from({ length: 1_024 }, (_, index) => (index % 13 - 6) / 16).buffer;
	const geometry = { frames: 1_024, channelCount: 1, sampleRate: 48_000 };
	const encoded = encodePcmAdaptively(raw, { ...geometry, runtime, requireWavPack: true });
	assert.equal(encoded.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	let first = true, actualDecodes = 0;
	const pcm = new PcmRepository({ codec: {
		async encode(input: ArrayBuffer) { return encodePcmAdaptively(input, { ...geometry, runtime, requireWavPack: true }); },
		async decode(input: ArrayBuffer) {
			const payload = decodePcmWithWavPack(input, { ...geometry, runtime, pcmCrc32: encoded.pcmCrc32 });
			actualDecodes += 1;
			assert.deepEqual(new Uint8Array(payload), new Uint8Array(raw), 'Every result comes from the actual pinned lossless decoder.');
			if (first) { first = false; stop.abort(reason); throw unrelated ?? reason; }
			return { payload };
		},
	} });
	return { pcm, raw, source: { channelCount: 1, sampleRate: 48_000 },
		record: () => ({ ...encoded, payload: encoded.payload.slice(0), index: 0, frames: geometry.frames }),
		actualDecodes: () => actualDecodes };
}

for (const kind of ['error', 'opaque', 'null', 'nan'] as const) test(`actual WavPack decode ${kind} cancellation remains exact before corruption classification`, { timeout: 15_000 }, async () => {
	const stop = new AbortController(), cancel = cancellation(kind), f = await fixture(stop, cancel.reason);
	const result = await outcome(f.pcm.decodeRecord(f.record(), f.source, stop.signal));
	assert.equal(result.rejected, true);
	if (result.rejected) assert.equal(Object.is(result.error, cancel.reason), true);
	cancel.assertUnreflected(); assert.equal(f.actualDecodes(), 1);
	const next = await f.pcm.decodeRecord(f.record(), f.source);
	assert.deepEqual(new Uint8Array(next.channels[0]!.buffer), new Uint8Array(f.raw));
	assert.equal(f.actualDecodes(), 2); cancel.assertUnreflected();
});

test('a distinct real-decode failure racing cancellation remains a corruption failure with the exact cause', { timeout: 15_000 }, async () => {
	const stop = new AbortController(), cancel = cancellation('opaque'), failure = new Error('The actual decode owner failed after verification.');
	const f = await fixture(stop, cancel.reason, failure);
	const result = await outcome(f.pcm.decodeRecord(f.record(), f.source, stop.signal));
	assert.equal(result.rejected, true);
	if (result.rejected) {
		assert.ok(result.error instanceof PcmStorageCorruptionError);
		assert.equal(result.error.code, 'PCM_WAVPACK_DECODE'); assert.equal(result.error.cause, failure);
		assert.notEqual(result.error, cancel.reason);
	}
	cancel.assertUnreflected(); assert.equal(f.actualDecodes(), 1);
	const next = await f.pcm.decodeRecord(f.record(), f.source);
	assert.deepEqual(new Uint8Array(next.channels[0]!.buffer), new Uint8Array(f.raw));
	assert.equal(f.actualDecodes(), 2);
});
