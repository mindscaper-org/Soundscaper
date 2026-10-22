/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { LightscaperNativePhotoResourcesCurrentV1 } from '../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { nativeBrushResourceCurrentV1, nativeCubeResourceCurrentV1, nativeResourceFixtureCurrentV1,
	nativeResourceBorrowCurrentV1, nativeResourceOpaqueCurrentV1, nativeResourceExactFailureCurrentV1 } from './helpers/lightscaper-native-photo-resources-fixture-current.ts';

type Family = 'lut' | 'brush';
async function familyPorts(owner: LightscaperNativePhotoResourcesCurrentV1, family: Family) {
	if (family === 'lut') {
		const resources = await owner.cubeLutResources(), input = nativeCubeResourceCurrentV1(), verify = resources.verifyReferencesV1;
		assert.equal(typeof verify, 'function'); assert.ok(verify);
		return { resources, input, verify: () => Reflect.apply(verify, resources, [[input.reference]]) as Promise<void> };
	}
	const resources = await owner.maskRasterResources(), input = nativeBrushResourceCurrentV1(), verify = resources.verifyReferencesV1;
	assert.equal(typeof verify, 'function'); assert.ok(verify);
	return { resources, input, verify: () => Reflect.apply(verify, resources, [[input.reference]]) as Promise<void> };
}

test('native resource factories are own captured capabilities and remain fenced after joined Close', async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath });
		try {
			const cube = Object.getOwnPropertyDescriptor(owner, 'cubeLutResources'), brush = Object.getOwnPropertyDescriptor(owner, 'maskRasterResources');
			assert.ok(cube && Object.hasOwn(cube, 'value')); assert.ok(brush && Object.hasOwn(brush, 'value'));
			const getCube = owner.cubeLutResources, getBrush = owner.maskRasterResources;
			const a = await getCube(), b = await getBrush();
			assert.equal(await getCube(), a); assert.equal(await getBrush(), b);
			for (const resources of [a, b]) {
				assert.equal(Object.isFrozen(resources), true); assert.equal(Object.isFrozen(resources.source), true);
				assert.equal(Object.hasOwn(resources, 'verifyReferencesV1'), true); assert.equal(typeof resources.verifyReferencesV1, 'function');
			}
			const closing = owner.close(); assert.equal(owner.close(), closing); await closing;
			await assert.rejects(getCube()); await assert.rejects(getBrush());
			await assert.rejects(a.put(nativeCubeResourceCurrentV1().reference, nativeCubeResourceCurrentV1().bytes));
			await assert.rejects(b.source.withBytes(nativeBrushResourceCurrentV1().reference, () => undefined));
		} finally { await owner.close(); }
	});
});

for (const family of ['lut', 'brush'] as const) test(`${family}: held render permits independent verify/install but never queues a second operation in a slot`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), f = await familyPorts(owner, family);
		const entered = deferred<void>(), release = deferred<void>(); let bytes: Uint8Array | undefined;
		let reading: Promise<unknown> | undefined;
		try {
			assert.equal((await f.resources.put(f.input.reference, f.input.bytes)).created, true);
			reading = nativeResourceBorrowCurrentV1(f.resources, f.input.reference, async value => { bytes = value; entered.resolve(); await release.promise; return 17; });
			await Promise.race([entered.promise, reading]);
			let captured = 0;
			const refused = new Proxy({}, { ownKeys() { captured++; throw new Error('Busy slot must not capture borrowed input.'); } });
			await assert.rejects(nativeResourceBorrowCurrentV1(f.resources, refused, () => undefined)); assert.equal(captured, 0);
			const verifying = f.verify(), installing = f.resources.put(f.input.reference, f.input.bytes);
			const verifyRefusal = f.verify(), installRefusal = f.resources.put(f.input.reference, f.input.bytes);
			await Promise.all([assert.rejects(verifyRefusal), assert.rejects(installRefusal)]);
			await verifying; assert.equal((await installing).created, false);
			assert.equal(await remainsPending(reading), true); assert.deepEqual(bytes, f.input.bytes);
			release.resolve(); assert.equal(await reading, 17); assert.ok(bytes?.every(value => value === 0));
		} finally { release.resolve(); await reading?.catch(() => undefined); await owner.close(); }
	});
});

for (const family of ['lut', 'brush'] as const) test(`${family}: Close fences synchronously, aborts read publication, joins actual consumer and wipes only after settlement`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), f = await familyPorts(owner, family);
		const entered = deferred<void>(), release = deferred<void>(), caller = new AbortController();
		let bytes: Uint8Array | undefined, reading: Promise<unknown> | undefined;
		try {
			await f.resources.put(f.input.reference, f.input.bytes);
			reading = nativeResourceBorrowCurrentV1(f.resources, f.input.reference, async value => { bytes = value; entered.resolve(); await release.promise; return 'late'; }, { signal: caller.signal });
			const result = reading.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
			await Promise.race([entered.promise, reading]); assert.equal(getEventListeners(caller.signal, 'abort').length, 1);
			const closing = owner.close(); assert.equal(owner.close(), closing);
			await assert.rejects(f.resources.put(f.input.reference, f.input.bytes));
			assert.equal(await remainsPending(reading), true); assert.equal(await remainsPending(closing), true);
			assert.deepEqual(bytes, f.input.bytes); release.resolve(); assert.equal((await result).ok, false); await closing;
			assert.ok(bytes?.every(value => value === 0)); assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
		} finally { release.resolve(); await reading?.catch(() => undefined); await owner.close(); }
	});
});

for (const family of ['lut', 'brush'] as const) test(`${family}: first opaque caller reason survives held consumer and Close without reflection`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), f = await familyPorts(owner, family);
		const entered = deferred<void>(), release = deferred<void>(), caller = new AbortController(), opaque = nativeResourceOpaqueCurrentV1();
		let reading: Promise<unknown> | undefined, bytes: Uint8Array | undefined;
		try {
			await f.resources.put(f.input.reference, f.input.bytes);
			reading = nativeResourceBorrowCurrentV1(f.resources, f.input.reference, async value => { bytes = value; entered.resolve(); await release.promise; }, { signal: caller.signal });
			const refusal = nativeResourceExactFailureCurrentV1(reading, opaque.reason);
			await Promise.race([entered.promise, reading]); caller.abort(opaque.reason); const closing = owner.close();
			assert.equal(await remainsPending(reading), true); assert.equal(await remainsPending(closing), true);
			release.resolve(); await refusal; await closing; assert.equal(opaque.traps(), 0);
			assert.ok(bytes?.every(value => value === 0)); assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
		} finally { release.resolve(); await reading?.catch(() => undefined); await owner.close(); }
	});
});

for (const family of ['lut', 'brush'] as const) test(`${family}: consumer rejection stays on the admitted scope; detached borrowed bytes do not block Close`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), f = await familyPorts(owner, family);
		const opaque = nativeResourceOpaqueCurrentV1();
		try {
			await f.resources.put(f.input.reference, f.input.bytes);
			await nativeResourceExactFailureCurrentV1(nativeResourceBorrowCurrentV1(f.resources, f.input.reference, bytes => {
				structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); throw opaque.reason;
			}), opaque.reason);
			assert.equal(opaque.traps(), 0);
			await nativeResourceBorrowCurrentV1(f.resources, f.input.reference, bytes => { assert.deepEqual(bytes, f.input.bytes); });
		} finally { await owner.close(); }
	});
});
