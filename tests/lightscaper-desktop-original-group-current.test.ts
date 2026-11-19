/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPhotoOriginalSourceCurrentV1 } from '../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import { originalGroupFixtureCurrentV1 as fixture, originalGroupShaCurrentV1 as sha } from './helpers/lightscaper-desktop-original-group-fixture-current.ts';

const deadline = { timeout: 15_000 }, RANGE = 1024 * 1024;
// Genuine File/byte ownership over explicit instrumented OPFS ports. Actual
// Chromium and native SQL group qualification are separate owning tests.
test('Lightscaper Original group stages each unique digest once but streams every independently bound Photo alias', deadline, async context => {
	const f = fixture(context), bytes = new Uint8Array(RANGE + 17).fill(23);
	try {
		const requests = [f.request(0, bytes), f.request(1, bytes), f.request(2, Uint8Array.of(7, 8))];
		const lease = await f.acquireGroup(requests); assert.equal(lease.bodies.length, 3);
		assert.equal(lease.bodies[0], lease.bodies[1]); assert.notEqual(lease.bodies[0], lease.bodies[2]);
		for (const [index, body] of lease.bodies.entries()) { assert.ok(body instanceof File); assert.equal(sha(new Uint8Array(await body.arrayBuffer())), requests[index]!.original.contentSha256); }
		assert.equal(f.counts().stages, 2); assert.equal(f.counts().written, bytes.length + 2); assert.equal(f.counts().maximumReading, 1);
		assert.deepEqual(f.ranges, [['photo-0', 0, RANGE], ['photo-0', RANGE, 17], ['photo-1', 0, RANGE], ['photo-1', RANGE, 17], ['photo-2', 0, 2]]);
		assert.equal(f.counts().groupCloses, 0); const close = lease.close(); assert.equal(close, lease.close()); await close;
		assert.equal(f.counts().stages, 0); assert.equal(f.counts().groupCloses, 1);
	} finally { await f.close(); }
});

test('Lightscaper Original group does not skip independent same-key aliases or expose a missing final locator prefix', deadline, async context => {
	for (const sameKey of [false, true]) {
		const f = fixture(context);
		try {
			const requests = [f.request(0, undefined, 'shared'), f.request(1, undefined, sameKey ? 'shared' : 'other')];
			f.replaceBytes('photo-1'); await assert.rejects(f.acquireGroup(requests), /missing/iu);
			assert.equal(f.ranges.some(value => value[0] === 'photo-1'), true); assert.equal(f.counts().stages, 0); assert.equal(f.counts().groupCloses, 1);
		} finally { await f.close(); }
	}
});

test('Lightscaper Original group authenticates a corrupt digest alias instead of trusting its claimed metadata', deadline, async context => {
	const f = fixture(context);
	try {
		const requests = [f.request(0), f.request(1)]; f.replaceBytes('photo-1', Uint8Array.of(1, 2, 9, 4, 5));
		await assert.rejects(f.acquireGroup(requests), /SHA|digest/iu); assert.equal(f.counts().written, 5); assert.equal(f.counts().stages, 0); assert.equal(f.counts().groupCloses, 1);
	} finally { await f.close(); }
});

test('Lightscaper Original group validates the persisted representative File independently of transferred bytes', deadline, async context => {
	const f = fixture(context);
	try {
		f.hooks.file = value => new File([new Uint8Array(value.size)], value.name);
		await assert.rejects(f.acquireGroup([f.request(0)]), /SHA/iu); assert.equal(f.counts().stages, 0); assert.equal(f.counts().groupCloses, 1);
	} finally { await f.close(); }
});

test('Lightscaper Original group reserves every logical entry against retained singles before opening anything', deadline, async context => {
	const f = fixture(context), request = f.request(9999, Uint8Array.of(1));
	try {
		const single = await f.acquire(request);
		const group = Array.from({ length: 4094 }, (_value, index) => f.request(index, Uint8Array.of(1), 'same'));
		await assert.rejects(f.acquireGroup(group), /capacity|budget/iu); assert.equal(f.counts().groupOpens, 0); assert.equal(f.counts().stages, 1);
		await single.close(); const lease = await f.acquireGroup(group); assert.equal(lease.bodies.length, 4094); assert.equal(f.counts().stages, 1);
		await lease.close(); assert.equal(f.counts().stages, 0);
	} finally { await f.close(); }
});

test('Lightscaper Original group reserves unique encoded bytes with singles before native open and allocates no advertised huge body', deadline, async context => {
	const f = fixture(context), held = f.gate(); f.hooks.groupOpen = async () => { await held.promise; };
	try {
		const seed = f.request(0), large = { ...seed, original: { ...seed.original, byteLength: 196 * RANGE } };
		const group = f.acquireGroup([large]); await f.reached('group-open-start', group);
		const other = { ...large, photoId: 'other' }; await assert.rejects(f.acquire(other), /capacity/iu);
		assert.equal(f.counts().opens, 0); assert.equal(f.counts().stages, 0);
		const closing = f.source.close(); held.release(); await assert.rejects(group); await closing; assert.equal(f.counts().groupCloses, 1);
	} finally { held.release(); await f.close(); }
});

test('Lightscaper Original group charges repeated compatible aliases once rather than their advertised byte sum', deadline, async context => {
	const f = fixture(context), held = f.gate(); f.hooks.groupOpen = async () => { await held.promise; };
	try {
		const seed = f.request(0), requests = [0, 1, 2].map(index => ({ ...seed, photoId: `large-${index}`, original: { ...seed.original, id: `source-${index}`, byteLength: 196 * RANGE } }));
		const group = f.acquireGroup(requests); await f.reached('group-open-start', group); assert.equal(f.counts().groupOpens, 1); assert.equal(f.counts().stages, 0);
		const closing = f.source.close(); held.release(); await assert.rejects(group); await closing;
	} finally { held.release(); await f.close(); }
});

test('Lightscaper Original groups and singles share four active admission slots without reflecting a fifth request', deadline, async context => {
	const f = fixture(context), held = f.gate(); f.hooks.groupOpen = async () => { await held.promise; }; f.hooks.open = f.hooks.groupOpen;
	const active: Promise<unknown>[] = [];
	try {
		active.push(f.acquireGroup([f.request(0)]), f.acquire(f.request(1)), f.acquireGroup([f.request(2)]), f.acquire(f.request(3)));
		for (const pending of active) void pending.catch(() => undefined);
		await f.reached('group-open-start', active[0]!); let traps = 0;
		const value = new Proxy([], { ownKeys() { traps++; throw new Error('Full work budget reflected input.'); } });
		await assert.rejects(f.acquireGroup(value), /capacity/iu); assert.equal(traps, 0); assert.equal(f.counts().groupOpens + f.counts().opens, 4);
		const closing = f.source.close(); held.release(); await Promise.allSettled(active); await closing;
	} finally { held.release(); await f.close(); }
});

test('Lightscaper Original group captures ordered full Originals before held open and closes a changed aligned receipt', deadline, async context => {
	const f = fixture(context), held = f.gate(); f.hooks.groupOpen = async () => { await held.promise; };
	try {
		const first = f.request(0), second = f.request(1), mutable = [{ ...first, original: { ...first.original } }, { ...second, original: { ...second.original } }];
		const work = f.acquireGroup(mutable); mutable[0]!.original.name = 'changed'; mutable.reverse();
		await f.reached('group-open-start', work); held.release(); const lease = await work;
		assert.equal(sha(new Uint8Array(await lease.bodies[0]!.arrayBuffer())), first.original.contentSha256); await lease.close();
		f.hooks.groupOpen = async () => undefined; f.hooks.receipt = value => ({ ...(value as object), originals: [second.original, first.original] });
		await assert.rejects(f.acquireGroup([first, second])); assert.equal(f.counts().groupCloses, 2); assert.equal(f.counts().stages, 0);
	} finally { held.release(); await f.close(); }
});

test('Lightscaper Original group admission refuses closed, duplicate, cross-catalog and conflicting digest metadata before transport', deadline, async context => {
	const f = fixture(context);
	try {
		const first = f.request(0), second = f.request(1);
		for (const input of [[first, first], [first, { ...second, catalogId: 'other' }], [first, { ...second, original: { ...second.original, width: 2 } }],
			[first, { ...second, path: '/renderer/path' }], new Array(4095).fill(first)]) await assert.rejects(f.acquireGroup(input));
		assert.equal(f.counts().groupOpens, 0); assert.equal(f.counts().stages, 0);
	} finally { await f.close(); }
});

test('Lightscaper Original group requires the complete optional wire triple and preserves single-only sources', deadline, async context => {
	const f = fixture(context);
	try {
		const single = { open: f.transport.open, read: f.transport.read, close: f.transport.close };
		for (const fields of [{ openGroup: f.transport.openGroup }, { openGroup: f.transport.openGroup, readGroup: f.transport.readGroup }]) {
			assert.throws(() => new DesktopPhotoOriginalSourceCurrentV1({ ...single, ...fields }, { storage: f.storage }));
		}
		const source = new DesktopPhotoOriginalSourceCurrentV1(single, { storage: f.storage });
		try { assert.equal(typeof Reflect.get(source, 'acquireGroup'), 'undefined'); } finally { await source.close(); }
	} finally { await f.close(); }
});


test('Lightscaper empty Original group publishes no resources and holds no native or staging reservation', deadline, async context => {
	const f = fixture(context);
	try {
		const lease = await f.acquireGroup([]); assert.deepEqual(lease.bodies, []); assert.equal(f.counts().groupOpens, 0); assert.equal(f.counts().stages, 0);
		await f.source.close(); await lease.close(); await lease.close();
	} finally { await f.close(); }
});
