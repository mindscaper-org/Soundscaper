/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';
const options = { concurrency: false, timeout: 15000 };
void test('Current revision-bound preview uses the actual selected HDR source and retained derivative cache', options, async context => {
	await fixture(context, async f => {
		const session = await f.open(), photo = f.photos[2]!;
		const first = await session.readPreview(photo.id, 'fit-screen', { expectedRevision: photo.revision });
		assert.equal(first.outcome, 'ready');
		const second = await session.readPreview(photo.id, 'fit-screen', { expectedRevision: photo.revision });
		assert.equal(second.outcome, 'ready');
		if (first.outcome === 'ready' && second.outcome === 'ready') {
			assert.equal(second.cache, 'hit'); assert.equal(second.preview.outputSha256, first.preview.outputSha256);
			assert.deepEqual(new Uint8Array(await second.preview.body.arrayBuffer()), new Uint8Array(await first.preview.body.arrayBuffer()));
		}
	});
});
void test('Current revision-bound preview refuses stale saved Photo even when its real cache is warm', options, async context => {
	await fixture(context, async f => {
		const session = await f.open(), photo = f.photos[2]!;
		assert.equal((await session.readPreview(photo.id, 'fit-screen')).outcome, 'ready');
		await session.setRating(photo.id, 4);
		await assert.rejects(session.readPreview(photo.id, 'fit-screen', { expectedRevision: photo.revision }), /revision|changed|conflict/iu);
	});
});
void test('Current preview revision is an optional exact nonnegative integer and remains closed', options, async context => {
	await fixture(context, async f => {
		const session = await f.open(), photo = f.photos[2]!;
		for (const value of [-1, -0, .5, Number.NaN, '0', null]) {
			await assert.rejects(session.readPreview(photo.id, 'fit-screen', { expectedRevision: value } as never));
		}
	});
});
