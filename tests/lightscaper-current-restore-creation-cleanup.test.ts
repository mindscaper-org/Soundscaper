/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { createPhotoMediaRestoreCandidateCurrentV1 } from '../src/lightscaper/storage/photo-media-restore-candidate-current-v1.ts';
import { PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, photoLibraryRestoreNamespacesV1, photoLibraryRestoreOwnerMarkerV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreAllocation, mediaRestoreFixture, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
type Candidate = Awaited<ReturnType<typeof createPhotoMediaRestoreCandidateCurrentV1>>;
type Outcome = { readonly ok: true; readonly value: Candidate } | { readonly ok: false; readonly error: unknown };
function observe(work: Promise<Candidate>): Promise<Outcome> {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

for (const failedDeletion of [false, true]) test(`Current restore creation joins ${failedDeletion ? 'failed' : 'successful'} owned deletion after its later native ownership open fails`, async t => {
	const f = mediaRestoreFixture(), open = f.factory.open.bind(f.factory), remove = f.factory.deleteDatabase.bind(f.factory);
	const token = () => randomUUID().replaceAll('-', '');
	const namespaceToken = token();
	const allocation = { ...mediaRestoreAllocation(), operationId: namespaceToken, namespaceToken, ownerToken: token() };
	const names = photoLibraryRestoreNamespacesV1(allocation), entered = deferred<void>(), release = deferred<void>();
	const options = { indexedDB: f.factory, allocation, root: mediaRestoreRoot(0) };
	const pending: Promise<Outcome>[] = [], attempts: { name: string; version?: number }[] = [], deletions: string[] = [];
	const primary = new DOMException('Later ownership open denied.', 'SecurityError'), cleanup = new DOMException('Owned deletion denied.', 'UnknownError');
	let initialOpen: IDBOpenDBRequest | undefined, namespaceCommitted = false, injected = false, committedMarker: unknown;
	t.after(async () => {
		release.resolve();
		const outcomes = await Promise.all(pending), owners = outcomes.flatMap(outcome => outcome.ok ? [outcome.value] : []);
		const retirement = await Promise.allSettled(owners.map(owner => owner.rollback()));
		f.factory.open = open; f.factory.deleteDatabase = remove;
		// Failed native deletion leaves this positively fresh fixture namespace present.
		if (failedDeletion && namespaceCommitted) await new Promise<void>((resolve, reject) => {
			const removal = remove(names.mediaDatabaseName);
			removal.onsuccess = () => { resolve(); }; removal.onerror = () => { reject(removal.error); };
		});
		const failures = retirement.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'Restore creation fixture retirement failed.');
	});
	f.factory.open = function (name, version) {
		assert.equal(this, f.factory); attempts.push({ name, version });
		// Shared store readiness opens with a version; fault only its later point proof.
		if (name === names.mediaDatabaseName && version === undefined && namespaceCommitted && !injected) {
			injected = true; throw primary;
		}
		const opening = open(name, version);
		if (!initialOpen && name === names.mediaDatabaseName && version !== undefined) {
			initialOpen = opening; let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
				get() { return (event: Event) => {
					committedMarker = f.raw(name).records(name, 'settings').find(row => row.key === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)?.value;
					namespaceCommitted = true; success?.call(opening, event);
				}; } });
		}
		return opening;
	};
	f.factory.deleteDatabase = function (name) {
		assert.equal(this, f.factory); deletions.push(name); entered.resolve();
		if (failedDeletion) {
			const removal = { onsuccess: null as IDBOpenDBRequest['onsuccess'], onerror: null as IDBOpenDBRequest['onerror'],
				onblocked: null as IDBOpenDBRequest['onblocked'], error: cleanup } as unknown as IDBOpenDBRequest;
			void release.promise.then(() => { removal.onerror?.call(removal, new Event('error')); });
			return removal;
		}
		const removal = remove(name); let success: IDBOpenDBRequest['onsuccess'] = null;
		Object.defineProperty(removal, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
			get() { return (event: Event) => { void release.promise.then(() => { success?.call(removal, event); }); }; } });
		return removal;
	};
	const creation = observe(createPhotoMediaRestoreCandidateCurrentV1(options)); pending.push(creation);
	assert.equal(await Promise.race([entered.promise.then(() => true), creation.then(() => false)]), true);
	assert.equal(namespaceCommitted, true); assert.equal(injected, true);
	assert.deepEqual(committedMarker, photoLibraryRestoreOwnerMarkerV1(allocation, 'media'));
	assert.deepEqual(deletions, [names.mediaDatabaseName]); assert.equal(await remainsPending(creation), true);
	const nativeAttempts = attempts.length, blocked = observe(createPhotoMediaRestoreCandidateCurrentV1(options)); pending.push(blocked);
	const held = await blocked; assert.equal(held.ok, false);
	if (!held.ok) assert.match(String(held.error), /already owns/iu);
	assert.equal(attempts.length, nativeAttempts); assert.equal(await remainsPending(creation), true);
	release.resolve();
	const outcome = await creation; assert.equal(outcome.ok, false);
	if (!outcome.ok) {
		if (failedDeletion) {
			assert.ok(outcome.error instanceof AggregateError); assert.equal(outcome.error.errors.length, 2);
			assert.equal(outcome.error.errors[0], primary); assert.equal(outcome.error.errors[1], cleanup);
		} else assert.equal(outcome.error, primary);
	}
	assert.ok(attempts.every(attempt => attempt.name === names.mediaDatabaseName));
	assert.equal(f.raw(names.mediaDatabaseName).stats.activeTransactions, 0);
	const beforeRetry = attempts.length, retry = observe(createPhotoMediaRestoreCandidateCurrentV1(options)); pending.push(retry);
	const next = await retry; assert.ok(attempts.length > beforeRetry);
	if (failedDeletion) {
		assert.equal(next.ok, false); if (!next.ok) assert.match(String(next.error), /already exists/iu);
		assert.deepEqual(deletions, [names.mediaDatabaseName]);
		assert.deepEqual(f.raw(names.mediaDatabaseName).records(names.mediaDatabaseName, 'settings').find(row => row.key === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)?.value, committedMarker);
	} else {
		assert.equal(next.ok, true); if (next.ok) { assert.equal(next.value.databaseName, names.mediaDatabaseName); await next.value.rollback(); }
		assert.deepEqual(deletions, [names.mediaDatabaseName, names.mediaDatabaseName]);
		assert.deepEqual(f.deleted, deletions);
	}
});
