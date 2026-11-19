/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoSessionCallsCurrentV1 as Calls } from '../desktop/lightscaper-native-photo-session-calls-current-v1.ts';
import { nativeSessionLeaseFixtureCurrentV1 as fixture, sessionLeaseShaCurrentV1 as sha } from './helpers/lightscaper-native-session-lease-integration-fixture-current.ts';

void test('Actual native writer and archive terminal retirement unregisters completed owners before long-lived Session close', { timeout: 15_000 }, async context => {
	const descriptor = Object.getOwnPropertyDescriptor(Calls.prototype, 'own'); assert.ok(descriptor && typeof descriptor.value === 'function');
	const native = descriptor.value as Calls['own']; let registered = 0, unregistered = 0;
	Object.defineProperty(Calls.prototype, 'own', { ...descriptor, value: function (this: Calls, retire: () => Promise<unknown>) {
		const release: unknown = Reflect.apply(native, this, [retire]); registered++;
		assert.equal(typeof release, 'function', 'Actual retirement registration must return its owning unregister capability.');
		let live = true;
		return (): void => { if (live) { live = false; unregistered++; } Reflect.apply(release as () => void, undefined, []); };
	} });
	try {
		await fixture(context, async f => {
			const bytes = Uint8Array.of(1, 2, 3), writer = await f.components.media.beginAssetWrite('terminal-real-commit', {}, { expectedBytes: bytes.length, expectedSha256: sha(bytes) });
			await writer.write(bytes); const metadata = await writer.commit(); assert.equal(metadata.sourceId, 'terminal-real-commit');
			assert.deepEqual({ registered, unregistered }, { registered: 1, unregistered: 1 });
			const aborted = await f.components.media.beginAssetWrite('terminal-real-abort', {}, { expectedBytes: 1, expectedSha256: sha(Uint8Array.of(9)) });
			assert.deepEqual({ registered, unregistered }, { registered: 2, unregistered: 1 }); await aborted.abort();
			assert.deepEqual({ registered, unregistered }, { registered: 2, unregistered: 2 });
			const capture = await f.components.catalog.captureSmartCollectionArchiveV1(f.lease.catalogId), iterator = capture.definitions[Symbol.asyncIterator]();
			assert.equal((await iterator.next()).done, true);
			assert.deepEqual({ registered, unregistered }, { registered: 3, unregistered: 2 }, 'Natural stream end alone cannot replace final verification.');
			await capture.verify(); assert.deepEqual({ registered, unregistered }, { registered: 3, unregistered: 3 });
			const returned = await f.components.catalog.captureSmartCollectionArchiveV1(f.lease.catalogId), source = returned.definitions[Symbol.asyncIterator]();
			assert.equal(typeof source.return, 'function'); await source.return?.();
			assert.deepEqual({ registered, unregistered }, { registered: 4, unregistered: 4 });
			await f.lease.close(); assert.deepEqual({ registered, unregistered }, { registered: 4, unregistered: 4 });
		});
	} finally { Object.defineProperty(Calls.prototype, 'own', descriptor); }
});
