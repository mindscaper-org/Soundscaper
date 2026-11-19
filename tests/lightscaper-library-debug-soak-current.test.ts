/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runPhotoLibraryDebugSoakCurrentV1 as run } from '../src/lightscaper/quality/photo-library-debug-soak-current-v1.ts';
import { nativeSessionRuntimeFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-native-session-runtime-integration-fixture-current.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

void test('Library debug soak uses complete native Current Sessions, real RAW import, saved reversible edits and PNG readback across three close/reopen rounds', { timeout: 15_000 }, async context => {
	const raw = await createRawFrameFixtureCurrentV1(), stop = new AbortController();
	const deadline = setTimeout(() => { stop.abort(new Error('Active diagnostic deadline.')); void raw.close().catch(() => undefined); }, 12_000);
	try { await raw.withDefaultTransport(() => fixture(context, async f => {
		const file = new File([f.raw], 'Owned tiny diagnostic.dng', { type: 'image/x-adobe-dng' });
		const before = createHash('sha256').update(f.raw).digest('hex');
		const report = await run({ createSession: () => f.open(), files: [file], iterations: 3, signal: stop.signal, storage: f.storage.storage });
		assert.equal(report.kind, 'photo-library-debug-soak'); assert.equal(report.iterations, 3);
		assert.equal(report.importedPhotos, 3); assert.equal(report.outputs.length, 3); assert.equal(report.originals.length, 3);
		assert.deepEqual(report.owners, { sessionsOpened: 6, sessionsClosed: 6, maximumLiveSessions: 1, activeSessions: 0, activeExports: 0, joined: true });
		for (const original of report.originals) { assert.equal(original.sha256, before); assert.equal(original.byteLength, f.raw.length); }
		for (const output of report.outputs) { assert.equal(output.width, 32); assert.equal(output.height, 32); assert.ok(output.byteLength > 0); assert.match(output.sha256, /^[a-f0-9]{64}$/u); assert.match(output.pixelsSha256, /^[a-f0-9]{64}$/u); }
		for (const phase of ['import', 'browse', 'search', 'save', 'export', 'restore', 'close', 'reopen']) assert.equal(report.phases.filter(value => value.phase === phase).length, 3, phase);
		assert.equal(report.memory.kind, 'unavailable'); if (report.memory.kind === 'unavailable') assert.equal(report.memory.reason, 'browser-heap-api-unavailable');
		for (const phase of report.phases) {
			assert.equal(phase.memory.kind, 'unavailable'); if (phase.memory.kind === 'unavailable') assert.equal(phase.memory.reason, 'browser-heap-api-unavailable');
			assert.equal(phase.owners.activeExports, 0); assert.equal(phase.owners.activeSessions, phase.phase === 'close' || phase.phase === 'reopen' ? 0 : 1);
		}
		assert.equal(f.storage.counts().stages, 0); assert.equal(createHash('sha256').update(f.raw).digest('hex'), before);
	})); } finally { clearTimeout(deadline); stop.abort(); await raw.close(); }
});

void test('Library debug soak cancellation joins a held actual OPFS write and the actual selected Session before it rejects', { timeout: 15_000 }, async context => {
	const raw = await createRawFrameFixtureCurrentV1(), stop = new AbortController(), reached = deferred<void>(), release = deferred<void>();
	const deadline = setTimeout(() => { stop.abort(new Error('Active diagnostic deadline.')); release.resolve(); }, 12_000);
	try { await raw.withDefaultTransport(() => fixture(context, async f => {
		let armed = false;
		f.storage.hooks.write = async () => { if (armed) { armed = false; reached.resolve(); await release.promise; } };
		const work = run({ createSession: () => f.open(), files: [new File([f.raw], 'Held diagnostic.dng')], iterations: 3,
			signal: stop.signal, storage: f.storage.storage, onPhase: value => { if (value.phase === 'export') armed = true; } });
		const settled = work.then(value => ({ value }), (error: unknown) => ({ error }));
		try {
			await Promise.race([reached.promise, settled.then(() => { throw new Error('Soak settled before actual write.'); })]);
			stop.abort(new DOMException('Stop diagnostic.', 'AbortError')); assert.equal(await remainsPending(settled), true);
		} finally { release.resolve(); }
		const result = await settled; assert.ok('error' in result); assert.equal(f.storage.counts().stages, 0);
		// A fresh actual selected lease proves the previous native Session has joined.
		const next = await f.open(); await next.readPage(); await next.close();
	})); } finally { clearTimeout(deadline); stop.abort(); release.resolve(); await raw.close(); }
});

void test('Library debug soak refuses invalid bounds before reflecting a factory or opening storage', { timeout: 15_000 }, async () => {
	let reflected = 0; const options = { iterations: 101, files: [new File([Uint8Array.of(1)], 'tiny.png')], get createSession(): never { reflected++; throw new Error('Must not reflect.'); } };
	await assert.rejects(run(options), RangeError); assert.equal(reflected, 0);
});
