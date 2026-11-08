/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { LightscaperNativePhotoResourcesCurrentV1 } from '../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { nativeBrushResourceCurrentV1, nativeCubeResourceCurrentV1, nativeResourceFixtureCurrentV1,
	nativeResourceBorrowCurrentV1, nativeResourceOpaqueCurrentV1, nativeResourceExactFailureCurrentV1 } from './helpers/lightscaper-native-photo-resources-fixture-current.ts';

for (const family of ['lut', 'brush'] as const) test(`${family}: install synchronously captures borrowed reference and bytes before async authentication`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath });
		const resources = family === 'lut' ? await owner.cubeLutResources() : await owner.maskRasterResources();
		const input = family === 'lut' ? nativeCubeResourceCurrentV1() : nativeBrushResourceCurrentV1();
		const expected = structuredClone(input);
		try {
			const installing = resources.put(input.reference, input.bytes);
			input.reference.byteLength++; input.bytes.fill(0);
			assert.deepEqual(await installing, { reference: expected.reference, created: true });
			await nativeResourceBorrowCurrentV1(resources, expected.reference, bytes => { assert.deepEqual(bytes, expected.bytes); });
		} finally { await owner.close(); }
	});
});

for (const family of ['lut', 'brush'] as const) test(`${family}: register before Proxy capture closes owner and preserve caller abort over later trap failure`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath });
		const resources = family === 'lut' ? await owner.cubeLutResources() : await owner.maskRasterResources();
		const input = family === 'lut' ? nativeCubeResourceCurrentV1() : nativeBrushResourceCurrentV1();
		const caller = new AbortController(), opaque = nativeResourceOpaqueCurrentV1(); let closing: Promise<void> | undefined, deliveries = 0, captures = 0;
		try {
			await resources.put(input.reference, input.bytes);
			const reference = new Proxy(input.reference, { ownKeys() {
				captures++; caller.abort(opaque.reason); closing = owner.close(); throw new Error('Late borrowed trap failure');
			} });
			await nativeResourceExactFailureCurrentV1(nativeResourceBorrowCurrentV1(resources, reference, () => { deliveries++; }, { signal: caller.signal }), opaque.reason);
			assert.equal(captures, 1); assert.ok(closing); await closing;
			assert.equal(deliveries, 0); assert.equal(opaque.traps(), 0); assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
			const reopened = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath });
			try { const next = family === 'lut' ? await reopened.cubeLutResources() : await reopened.maskRasterResources();
				await nativeResourceBorrowCurrentV1(next, input.reference, bytes => { assert.deepEqual(bytes, input.bytes); }); }
			finally { await reopened.close(); }
		} finally { await owner.close(); }
	});
});

test('native resource pre-abort, closed records and byte geometry refuse without getters or reason reflection', async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), resources = await owner.maskRasterResources(), input = nativeBrushResourceCurrentV1();
		const caller = new AbortController(), opaque = nativeResourceOpaqueCurrentV1(); let getters = 0;
		const ResizableBuffer = ArrayBuffer as unknown as new (size: number, options: { maxByteLength: number }) => ArrayBuffer;
		try {
			caller.abort(opaque.reason);
			await nativeResourceExactFailureCurrentV1(resources.put(input.reference, input.bytes, { signal: caller.signal }), opaque.reason);
			await nativeResourceExactFailureCurrentV1(nativeResourceBorrowCurrentV1(resources, input.reference, () => assert.fail('pre-aborted read delivered'), { signal: caller.signal }), opaque.reason);
			const getter = Object.defineProperty({}, 'signal', { enumerable: true, get() { getters++; return undefined; } });
			await assert.rejects(resources.put(input.reference, input.bytes, getter));
			await assert.rejects(resources.put({ ...input.reference, future: true }, input.bytes));
			await assert.rejects(resources.put(input.reference, new Uint8Array(new SharedArrayBuffer(input.bytes.length))));
			await assert.rejects(resources.put(input.reference, new Uint8Array(new ResizableBuffer(input.bytes.length, { maxByteLength: input.bytes.length }))));
			const shadow = new AbortController(); Object.defineProperty(shadow.signal, 'aborted', { value: false });
			await assert.rejects(resources.put(input.reference, input.bytes, { signal: shadow.signal }));
			assert.equal(getters, 0); assert.equal(opaque.traps(), 0); assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
			assert.equal((await resources.put(input.reference, input.bytes)).created, true);
		} finally { await owner.close(); }
	});
});

test('LUT import uses the captured native Blob body and reuses exact UTF8 bytes; declared overrides and BOM never become authority', async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), resources = await owner.cubeLutResources(), input = nativeCubeResourceCurrentV1();
		class LocalBlob extends Blob { override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Borrowed Blob method invoked'); } }
		try {
			assert.deepEqual(await resources.importFile(new LocalBlob([input.bytes])), { reference: input.reference, created: true });
			assert.deepEqual(await resources.importFile(new Blob([input.bytes])), { reference: input.reference, created: false });
			await assert.rejects(resources.importFile(new Blob([Uint8Array.of(0xef, 0xbb, 0xbf), input.bytes])));
			await assert.rejects(resources.importFile(new Blob([Uint8Array.of(0xff)])));
			await assert.rejects(resources.importFile({ size: input.bytes.length, arrayBuffer: async () => input.bytes.buffer } as Blob));
			await nativeResourceBorrowCurrentV1(resources, input.reference, bytes => { assert.deepEqual(bytes, input.bytes); });
		} finally { await owner.close(); }
	});
});
