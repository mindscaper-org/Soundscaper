/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { captureDesktopPhotoCloneCurrentV1 as encode, retireDesktopPhotoCloneCurrentV1 as retire } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import { nativeSessionProtocolFixtureCurrentV1 as fixture, channels } from './helpers/lightscaper-native-session-protocol-integration-fixture-current.ts';

void test('Main reserves portable receipt field capacity before genuine asset publication can start', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const metadata: Record<string, unknown> = { name: 'Portable field capacity' };
		for (let index = 0; index < 131_067; index++) metadata[`k${String(index)}`] = 0;
		const wire = await encode(metadata); let issued: unknown;
		try {
			// Input and actual normalized descriptive graph fit131072fields;
			// the six native receipt fields would overflow only after COMMIT.
			await assert.rejects(f.call(channels.upload, { operation: 'asset-begin', assetId: 'metadata-field-capacity', metadata: wire,
				expectedBytes: 1, expectedSha256: createHash('sha256').update(Uint8Array.of(3)).digest('hex') }).then(value => { assert.ok(value && typeof value === 'object'); issued = Reflect.get(value, 'handle'); return value; }), RangeError);
			assert.equal(await f.components.media.getAssetMetadata('metadata-field-capacity'), null);
		} finally { retire(wire); if (issued) await f.call(channels.upload, { operation: 'abort', handle: issued }); }
	});
});
