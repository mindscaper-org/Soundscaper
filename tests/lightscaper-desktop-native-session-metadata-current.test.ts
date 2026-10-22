/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { captureDesktopPhotoCloneCurrentV1 as encode, readDesktopPhotoCloneCurrentV1 as decode, retireDesktopPhotoCloneCurrentV1 as retire } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { nativeSessionProtocolFixtureCurrentV1 as fixture, channels } from './helpers/lightscaper-native-session-protocol-integration-fixture-current.ts';
const options = { timeout: 15_000 };
const handle = (value: unknown): unknown => { assert.ok(value && typeof value === 'object'); return Reflect.get(value, 'handle'); };

void test('Main preflights the actual normalized cyclic metadata reply before a native writer can accept body work', options, async context => {
	await fixture(context, async f => {
		const handles: unknown[] = []; let issued: unknown, wire: unknown;
		try {
			// Genuine negative upload reservations retain124MiB without claiming
			// a parsed resource or publishing any invented body.
			for (let index = 0; index < 8; index++) handles.push(handle(await f.call(channels.upload, { operation: 'resource-begin', family: 'lut',
				reference: { ...f.resource.lut.reference, byteLength: (index < 7 ? 16 : 12) * 1024 * 1024 } })));
			const metadata: Record<string, unknown> = { name: 'n'.repeat(1024 * 1024) }; metadata.self = metadata;
			wire = await encode(metadata);
			await assert.rejects(f.call(channels.upload, { operation: 'asset-begin', assetId: 'metadata-capacity', metadata: wire,
				expectedBytes: f.raw.byteLength, expectedSha256: createHash('sha256').update(f.raw).digest('hex') }).then(value => { issued = handle(value); return value; }), RangeError);
			assert.equal(await f.components.media.getAssetMetadata('metadata-capacity'), null);
		} finally {
			retire(wire); if (issued) await f.call(channels.upload, { operation: 'abort', handle: issued });
			for (const owned of handles) await f.call(channels.upload, { operation: 'abort', handle: owned });
		}
	});
});

void test('Main owns one metadata-read lane while the actual native lookup and portable reply remain pending', options, async context => {
	await fixture(context, async f => {
		const first = f.call(channels.upload, { operation: 'metadata', assetId: 'runtime-shared' });
		const second = f.call(channels.upload, { operation: 'metadata', assetId: 'runtime-shared' });
		const [a, b] = await Promise.allSettled([first, second]);
		assert.equal(a.status, 'fulfilled');
		if (a.status === 'fulfilled') { const metadata = await decode(a.value); assert.ok(metadata && typeof metadata === 'object'); assert.equal(Reflect.get(metadata, 'sourceId'), 'runtime-shared'); }
		assert.equal(b.status, 'rejected'); if (b.status === 'rejected') assert.ok(b.reason instanceof RangeError);
	});
});

void test('Main bounds actual stored metadata in its atomic SQL projection before native decode', options, async context => {
	await fixture(context, async f => {
		const db = new DatabaseSync(paths(f.directory).databasePath);
		try {
			// SQLite creates this BLOB in its own file; no JS body allocation or
			// binary failure diff. The unchanged native table allows196MiB.
			db.prepare('UPDATE native_photo_media_assets SET metadata=zeroblob(?) WHERE source_id=?').run(134_217_729, 'runtime-shared');
			await assert.rejects(f.call(channels.upload, { operation: 'metadata', assetId: 'runtime-shared' }), RangeError);
		} finally { db.close(); }
	});
});
