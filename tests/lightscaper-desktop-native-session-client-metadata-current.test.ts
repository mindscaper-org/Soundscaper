/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls } from '../src/lightscaper/desktop-photo-library-session-client-calls-current-v1.ts';
import { captureDesktopPhotoCloneCurrentV1 as encode, measureDesktopPhotoCloneCurrentV1 as measure, retireDesktopPhotoCloneCurrentV1 as retire } from '../src/lightscaper/desktop-photo-clone-current-v1.ts';
import { nativeSessionClientFixtureCurrentV1 as fixture, runtimeShaCurrentV1 as sha } from './helpers/lightscaper-desktop-native-session-client-integration-fixture-current.ts';
const options = { timeout: 15_000 };
function operation(value: unknown): unknown { if (!value || typeof value !== 'object') return; const p: unknown = Reflect.get(value, 'payload'); return p && typeof p === 'object' ? Reflect.get(p, 'operation') as unknown : undefined; }

void test('Client metadata preparation refuses overlap before a second native clone can reflect its metadata', options, async context => {
	await fixture(context, async f => {
		const session = await f.open(); await session.readPage(); const entered = f.gate(), release = f.gate(); let held = false;
		f.hooks.reply = async (channel, payload) => { if (!held && channel.endsWith(':upload') && operation(payload) === 'asset-begin') { held = true; entered.release(); await release.promise; } };
		const binding = { expectedBytes: f.raw.byteLength, expectedSha256: sha(f.raw) };
		const first = f.components.media.beginAssetWrite('client-metadata-first', { name: 'First', host: new Blob([Uint8Array.of(7)]) }, binding);
		void first.catch(() => undefined);
		try {
			await f.reached(entered.promise, first); let reflected = 0;
			const poison = Object.defineProperty({}, 'name', { enumerable: true, get() { reflected++; throw new Error('Second metadata clone was entered.'); } });
			await assert.rejects(f.components.media.beginAssetWrite('client-metadata-second', poison, binding), RangeError); assert.equal(reflected, 0);
		} finally { release.release(); const outcome = await Promise.allSettled([first]); if (outcome[0]?.status === 'fulfilled') await outcome[0].value.abort(); }
	});
});

void test('Client measured metadata wire debt survives actual SEND and escaped writer until real terminal retirement', options, async context => {
	const actual = Calls.prototype.reserve; let liveBytes = 0;
	Calls.prototype.reserve = function(this: Calls, byteLength: number) {
		const release = Reflect.apply(actual, this, [byteLength]) as () => void; liveBytes += byteLength; let live = true;
		return () => { release(); if (live) { live = false; liveBytes -= byteLength; } };
	};
	try { await fixture(context, async f => {
		const session = await f.open(); await session.readPage(); const entered = f.gate(), release = f.gate(); let held = false;
		const metadata = { name: 'Metadata debt', value: 'x'.repeat(1024), host: new Blob([Uint8Array.of(1, 2, 3)]) }, wire = await encode(metadata);
		const expected = measure(wire); retire(wire);
		f.hooks.reply = async (channel, payload) => { if (!held && channel.endsWith(':upload') && operation(payload) === 'asset-begin') { held = true; entered.release(); await release.promise; } };
		const work = f.components.media.beginAssetWrite('client-metadata-debt', metadata, { expectedBytes: f.raw.byteLength, expectedSha256: sha(f.raw) }); void work.catch(() => undefined);
		let writer: Awaited<typeof work> | undefined;
		try { await f.reached(entered.promise, work); assert.ok(liveBytes >= expected, 'Actual metadata body debt must remain charged across SEND.');
			release.release(); writer = await work; assert.ok(liveBytes >= expected, 'Escaped writer retains native metadata publication debt.');
		} finally { release.release(); const outcomes = await Promise.allSettled([work]); if (outcomes[0]?.status === 'fulfilled') writer = outcomes[0].value; await writer?.abort(); }
		assert.equal(liveBytes, 0);
	}); } finally { Calls.prototype.reserve = actual; }
});

void test('Metadata preparation lane does not reduce the sixteen genuine escaped writer handles', options, async context => {
	await fixture(context, async f => {
		const session = await f.open(); await session.readPage(); const writers: Awaited<ReturnType<typeof f.components.media.beginAssetWrite>>[] = [];
		try { for (let index = 0; index < 16; index++) writers.push(await f.components.media.beginAssetWrite(`client-metadata-slot-${String(index)}`, { name: 'Small actual writer' }, { expectedBytes: 1, expectedSha256: sha(Uint8Array.of(3)) })); assert.equal(writers.length, 16); }
		finally { for (const writer of writers) await writer.abort(); }
	});
});
