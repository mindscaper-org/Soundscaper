/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { captureDesktopPhotoCloneCurrentV1 as encode, readDesktopPhotoCloneCurrentV1 as decode } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import { nativeSessionProtocolFixtureCurrentV1 as fixture, channels } from './helpers/lightscaper-native-session-protocol-integration-fixture-current.ts';
const options = { timeout: 15_000 };
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function handle(value: unknown): unknown { assert.ok(value && typeof value === 'object'); return Reflect.get(value, 'handle'); }

void test('Actual Main streamed asset writer publishes real Original bytes and detached portable metadata', options, async context => {
	await fixture(context, async f => {
		const metadata = await encode({ name: 'Wire actual.dng', mimeType: f.photos[0]!.original.mimeType, custom: { title: 'Native writer' }, stamp: 17n });
		const receipt = await f.call(channels.upload, { operation: 'asset-begin', assetId: 'wire-asset', metadata, expectedBytes: f.raw.byteLength, expectedSha256: sha(f.raw) });
		const upload = handle(receipt);
		try {
			assert.deepEqual(await f.call(channels.upload, { operation: 'write', handle: upload, sequence: 0, offset: 0, bytes: f.raw }), { sequence: 0, offset: f.raw.byteLength });
			await assert.rejects(f.call(channels.upload, { operation: 'write', handle: upload, sequence: 0, offset: 0, bytes: f.raw }));
			const committed = await decode(await f.call(channels.upload, { operation: 'commit', handle: upload })); assert.ok(committed && typeof committed === 'object');
			assert.equal(Reflect.get(committed, 'sourceId'), 'wire-asset'); assert.equal(Reflect.get(committed, 'stamp'), 17n); assert.equal(Reflect.get(committed, 'sha256'), sha(f.raw));
			const stored = await decode(await f.call(channels.upload, { operation: 'metadata', assetId: 'wire-asset' })); assert.ok(stored && typeof stored === 'object');
			assert.equal(Reflect.get(stored, 'stamp'), 17n);
		} finally { await f.call(channels.upload, { operation: 'abort', handle: upload }); }
	});
});

void test('Actual Main resource callback stays owned through exact-purpose handle and bounded byte pulls', options, async context => {
	await fixture(context, async f => {
		const receipt = await f.call(channels.resource, { operation: 'open', family: 'lut', reference: f.resource.lut.reference }), resource = handle(receipt);
		try {
			const bytes = await f.call(channels.resource, { operation: 'read', handle: resource, offset: 0, length: f.resource.lut.bytes.byteLength });
			assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.resource.lut.bytes)); bytes.fill(0);
			await assert.rejects(f.call(channels.cache, { operation: 'download', handle: resource, offset: 0, length: 1 }));
		} finally { await f.call(channels.resource, { operation: 'close', handle: resource }); }
		await f.call(channels.resource, { operation: 'close', handle: resource });
	});
});

void test('Actual Main single and whole-group Original transports preserve all independently authorized aliases', options, async context => {
	await fixture(context, async f => {
		const requests = f.photos.slice(0, 2).map(photo => ({ catalogId: photo.catalogId, photoId: photo.id, original: photo.original }));
		const single = await f.call(channels.originalOpen, { request: requests[0] }); assert.ok(single && typeof single === 'object'); const ticket = { id: Reflect.get(single, 'id') };
		try { const bytes = await f.call(channels.originalRead, { ticket: single, offset: 0, length: f.raw.byteLength }); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.raw)); }
		finally { await f.call(channels.originalClose, { ticket }); }
		const group = await f.call(channels.originalOpenGroup, { requests }); assert.ok(group && typeof group === 'object'); const groupId = { id: Reflect.get(group, 'id') };
		try {
			for (let index = 0; index < requests.length; index++) { const bytes = await f.call(channels.originalReadGroup, { group: groupId, index, offset: 0, length: f.raw.byteLength }); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.raw)); }
			// Logical custody retirement is allowed; actual physical asset
			// deletion must remain refused by the retained group token pins.
			await f.call(channels.custody, { operation: 'release', photoIds: requests.map(request => request.photoId) });
			await assert.rejects(f.call(channels.upload, { operation: 'delete-asset', assetId: 'runtime-shared' }));
		} finally { await f.call(channels.originalCloseGroup, { group: groupId }); }
		await f.call(channels.upload, { operation: 'delete-asset', assetId: 'runtime-shared' });
	});
});

void test('Actual Main books sixteen bounded upload handles before the next nested reference can be reflected, then drains outside data capacity', options, async context => {
	await fixture(context, async f => {
		const handles: unknown[] = []; let reflected = 0;
		try {
			for (let index = 0; index < 16; index++) handles.push(handle(await f.call(channels.upload, { operation: 'resource-begin', family: 'lut', reference: f.resource.lut.reference })));
			const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('Capacity refusal must precede reference reflection.'); } });
			await assert.rejects(f.call(channels.upload, { operation: 'resource-begin', family: 'lut', reference: poison }), RangeError); assert.equal(reflected, 0);
		} finally { for (const upload of handles) await f.call(channels.upload, { operation: 'abort', handle: upload }); }
	});
});

void test('Actual Main saved archive owns one captured native iterator and final verification', options, async context => {
	await fixture(context, async f => {
		const opened = await f.call(channels.archive, { operation: 'open' }), archive = handle(opened);
		try { assert.deepEqual(await f.call(channels.archive, { operation: 'next', handle: archive }), { done: true }); await f.call(channels.archive, { operation: 'verify', handle: archive }); }
		finally { await f.call(channels.archive, { operation: 'return', handle: archive }); }
	});
});
