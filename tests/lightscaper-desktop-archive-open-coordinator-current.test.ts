/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { deferred } from './helpers/async-test-control.ts';
import { createLightscaperArchiveOpenCoordinatorCurrentV1, type LightscaperArchiveOpenPortsCurrentV1 } from '../desktop/lightscaper-archive-open-coordinator-current-v1.ts';

const first = resolve('/tmp/lightscaper-open/first.liscape'), second = resolve('/tmp/lightscaper-open/second.scape');
function descriptor(name = 'first.liscape', letter = 'a') {
	const id = letter.repeat(64);
	return { id, url: `lightscaper-app://bundle/_desktop/read/scape-range-v1/${id}/${encodeURIComponent(name)}`,
		name, size: 16, mimeType: 'application/vnd.soundscaper.scape+zip', readProfile: 'scape-range-v1', lastModified: 0 };
}
function fixture(overrides: Partial<LightscaperArchiveOpenPortsCurrentV1> = {}) {
	const registrations: { path: string; owner: object }[] = [], releases: { id: string; owner: object }[] = [], revocations: object[] = [];
	const events: { owner: object; event: Readonly<{ available: boolean }> }[] = [];
	const ports: LightscaperArchiveOpenPortsCurrentV1 = {
		async register(path, owner) { registrations.push({ path, owner }); return descriptor(); },
		async release(id, owner) { releases.push({ id, owner }); return true; },
		async revokeOwner(owner) { revocations.push(owner); },
		notify(owner, event) { events.push({ owner, event }); }, ...overrides,
	};
	return { coordinator: createLightscaperArchiveOpenCoordinatorCurrentV1(ports), registrations, releases, revocations, events };
}

test('Lightscaper native queue bounds all pending authority, deduplicates paths and wakes only a ready owner', async () => {
	const f = fixture(), owner = Object.freeze({});
	assert.equal(f.coordinator.enqueuePath(first), 'queued'); assert.equal(f.events.length, 0);
	assert.equal(f.coordinator.enqueuePath(first), 'duplicate'); assert.equal(f.coordinator.enqueuePath('relative.liscape'), 'invalid');
	for (let index = 1; index < 16; index++) assert.equal(f.coordinator.enqueuePath(resolve(`/tmp/lightscaper-open/${index}.fscape`)), 'queued');
	assert.equal(f.coordinator.enqueuePath(second), 'full');
	await f.coordinator.replaceOwner(owner);
	assert.equal(f.events.at(-1)?.owner, owner); assert.deepEqual(f.events.at(-1)?.event, { available: true });
	await f.coordinator.close();
});

test('Lightscaper simultaneous dequeues grant one descriptor and finish joins one release before the next grant', async () => {
	const finish = deferred<boolean>(), f = fixture({ release: () => finish.promise }), owner = {};
	await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first); f.coordinator.enqueuePath(second);
	const [one, two] = await Promise.all([f.coordinator.takeArchive(owner), f.coordinator.takeArchive(owner)]);
	assert.equal(one?.id, 'a'.repeat(64)); assert.equal(two, null); assert.equal(f.registrations.length, 1);
	assert.equal(f.coordinator.enqueuePath(first), 'duplicate');
	const retiring = f.coordinator.finishArchive(owner, { id: one!.id });
	assert.equal(await f.coordinator.takeArchive(owner), null);
	finish.resolve(true); await retiring;
	assert.equal((await f.coordinator.takeArchive(owner))?.name, 'first.liscape'); assert.equal(f.registrations.length, 2);
	await f.coordinator.close();
});

test('Lightscaper registration failure reports the owned file and permits the next queued file without leaking a grant', async () => {
	let calls = 0; const f = fixture({ async register() { if (++calls === 1) throw new Error('Owned file is unavailable'); return descriptor('second.scape'); } }), owner = {};
	await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first); f.coordinator.enqueuePath(second);
	await assert.rejects(f.coordinator.takeArchive(owner), /unavailable/u);
	assert.equal((await f.coordinator.takeArchive(owner))?.name, 'second.scape'); assert.equal(f.releases.length, 0);
	await f.coordinator.close();
});

test('Lightscaper owner replacement while registration awaits revokes, joins and requeues the undelivered path', async () => {
	const started = deferred<void>(), registration = deferred<unknown>(), retired = deferred<boolean>();
	let calls = 0; const owner = {}, replacement = {};
	const f = fixture({ register: async () => { if (++calls === 1) { started.resolve(); return registration.promise; } return descriptor(); },
		release: () => retired.promise });
	await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first);
	const taking = f.coordinator.takeArchive(owner); await started.promise;
	const replacing = f.coordinator.replaceOwner(replacement);
	assert.deepEqual(f.revocations, [owner]); assert.equal(await f.coordinator.takeArchive(replacement), null);
	registration.resolve(descriptor()); retired.resolve(true);
	assert.equal(await taking, null); await replacing;
	assert.ok(await f.coordinator.takeArchive(replacement)); assert.equal(calls, 2);
	await f.coordinator.close();
});

test('Lightscaper invalidation requeues outstanding grants but never repeats a successfully finished delivery', async () => {
	const f = fixture(), a = {}, b = {}, c = {};
	await f.coordinator.replaceOwner(a); f.coordinator.enqueuePath(first);
	assert.ok(await f.coordinator.takeArchive(a)); await f.coordinator.replaceOwner(b);
	const delivery = await f.coordinator.takeArchive(b); assert.ok(delivery);
	await f.coordinator.finishArchive(b, { id: delivery.id }); await f.coordinator.replaceOwner(c);
	assert.equal(await f.coordinator.takeArchive(c), null);
	await f.coordinator.close();
});

test('Lightscaper finish rejects a foreign owner, wrong identity and extra fields without releasing authority', async () => {
	const f = fixture(), owner = {}; await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first);
	const delivery = await f.coordinator.takeArchive(owner); assert.ok(delivery);
	for (const request of [{ id: 'b'.repeat(64) }, { id: delivery.id, path: first }]) await assert.rejects(f.coordinator.finishArchive(owner, request));
	await assert.rejects(f.coordinator.finishArchive({}, { id: delivery.id })); assert.equal(f.releases.length, 0);
	await f.coordinator.finishArchive(owner, { id: delivery.id }); await f.coordinator.close();
});

test('Lightscaper release failure fences the next grant and close still joins native owner revocation', async () => {
	for (const failure of [new Error('Native retirement failed')]) {
		const f = fixture({ async release() { throw failure; } }), owner = {};
		await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first); f.coordinator.enqueuePath(second);
		const delivery = await f.coordinator.takeArchive(owner); assert.ok(delivery);
		await assert.rejects(f.coordinator.finishArchive(owner, { id: delivery.id }));
		await assert.rejects(f.coordinator.takeArchive(owner)); await assert.rejects(f.coordinator.close());
		assert.deepEqual(f.revocations, [owner]);
	}
});

test('Lightscaper late malformed native descriptor revokes its owner instead of exposing or stranding authority', async () => {
	const f = fixture({ register: async () => ({ ...descriptor(), path: first }) }), owner = {};
	await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first);
	await assert.rejects(f.coordinator.takeArchive(owner)); assert.deepEqual(f.revocations, [owner]);
	await assert.rejects(f.coordinator.close());
});

test('Lightscaper close joins pending registration and release and never admits a new owner afterward', async () => {
	const started = deferred<void>(), registration = deferred<unknown>(), retired = deferred<boolean>();
	const f = fixture({ register: async () => { started.resolve(); return registration.promise; }, release: () => retired.promise }), owner = {};
	await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first);
	const taking = f.coordinator.takeArchive(owner); await started.promise;
	let closed = false; const closing = f.coordinator.close().then(() => { closed = true; });
	registration.resolve(descriptor()); await Promise.resolve(); assert.equal(closed, false);
	retired.resolve(true); assert.equal(await taking, null); await closing;
	assert.equal(f.coordinator.enqueuePath(second), 'invalid'); await assert.rejects(f.coordinator.replaceOwner({}));
});


test('Lightscaper finish accepts its exact ticket already retired by protocol cancellation', async () => {
	const f = fixture({ release: async () => false }), owner = {};
	await f.coordinator.replaceOwner(owner); f.coordinator.enqueuePath(first); f.coordinator.enqueuePath(second);
	const delivery = await f.coordinator.takeArchive(owner); assert.ok(delivery);
	await f.coordinator.finishArchive(owner, { id: delivery.id });
	assert.ok(await f.coordinator.takeArchive(owner)); await f.coordinator.close();
});

test('Lightscaper registration rejected by old-owner revocation requeues once for the latest ready owner', async () => {
	const started = deferred<void>(), registration = deferred<unknown>(); let calls = 0;
	const f = fixture({ register: async () => { if (++calls === 1) { started.resolve(); return registration.promise; } return descriptor(); } });
	const a = {}, b = {}, c = {}; await f.coordinator.replaceOwner(a); f.coordinator.enqueuePath(first);
	const taking = f.coordinator.takeArchive(a); await started.promise;
	const replacingB = f.coordinator.replaceOwner(b), replacingC = f.coordinator.replaceOwner(c);
	registration.reject(new Error('Old native admission revoked'));
	assert.equal(await taking, null); await replacingB; await replacingC;
	assert.equal(await f.coordinator.takeArchive(b), null); assert.ok(await f.coordinator.takeArchive(c));
	assert.equal(calls, 2); await f.coordinator.close();
});

test('Lightscaper navigation during finish joins cleanup and preserves the unfinished native handoff', async () => {
	const retirement = deferred<boolean>(), f = fixture({ release: () => retirement.promise }), a = {}, b = {};
	await f.coordinator.replaceOwner(a); f.coordinator.enqueuePath(first);
	const delivery = await f.coordinator.takeArchive(a); assert.ok(delivery);
	const finishing = f.coordinator.finishArchive(a, { id: delivery.id }), replacing = f.coordinator.replaceOwner(b);
	assert.equal(await f.coordinator.takeArchive(b), null);
	retirement.resolve(true); await finishing; await replacing;
	assert.ok(await f.coordinator.takeArchive(b)); await f.coordinator.close();
});
