/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiPendingSnapshotAdmission } from '../src/common/editor/controller/composition/internal/midi-controller-port.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

function fixture() {
	const ready = deferred<void>();
	let project = { id: 'project', revision: 0 }, target = 'clip:0:100', active = true, pending = true, settles = 0;
	const requests: object[] = [];
	const admission = createMidiPendingSnapshotAdmission({
		hasPendingEdits: () => pending, getProject: () => project,
		settled: async (expected: object) => { requests.push(expected); settles++; await ready.promise; },
		captureTarget: () => target, active: () => active,
	});
	return {
		admission, requests, get project() { return project; }, get settles() { return settles; },
		setPending: (value: boolean) => { pending = value; },
		retarget: () => { target = 'other:0:100'; }, dispose: () => { active = false; },
		publishMidi: () => { project = { ...project, revision: 1 }; pending = false; ready.resolve(); },
	};
}

test('idle PCM consumers preserve their direct result and never load or settle MIDI', () => {
	const f = fixture(); f.setPending(false);
	assert.equal(f.admission.run((value: number) => value + 1)(2), 3);
	assert.equal(f.settles, 0);
});

test('pending PCM capture uses the existing expected-object authority and reads owned MIDI publication', async () => {
	const f = fixture(), origin = f.project;
	const reading = f.admission.run(() => f.project.revision)(); await settle();
	assert.deepEqual(f.requests, [origin]); f.publishMidi(); assert.equal(await reading, 1);
});

for (const action of ['selection', 'dispose'] as const) test(`${action} retires queued PCM instead of retargeting it`, async () => {
	const f = fixture(); let calls = 0;
	const reading = f.admission.run(() => ++calls)(); await settle();
	if (action === 'selection') f.retarget(); else f.dispose();
	f.publishMidi(); await assert.rejects(Promise.resolve(reading), { name: 'AbortError' });
	assert.equal(calls, 0);
});

test('Cancel releases an uncooperative wait without cancelling the earlier MIDI edit', async () => {
	const f = fixture(); let calls = 0;
	const reading = f.admission.run(() => ++calls)(); await settle(); f.admission.cancel();
	await assert.rejects(Promise.resolve(reading), { name: 'AbortError' }); assert.equal(f.project.revision, 0);
	f.publishMidi(); await settle(); assert.equal(f.project.revision, 1); assert.equal(calls, 0);
});

test('cancelled default preparation cannot start when its before-read callback is invoked later', async () => {
	const f = fixture(), read = f.admission.beforeRead(); assert.ok(read);
	f.admission.cancel(); await assert.rejects(read(), { name: 'AbortError' }); assert.equal(f.settles, 0);
});

test('newer queued work survives an earlier cancelled wait completing late', async () => {
	const f = fixture(); let calls = 0;
	const old = f.admission.run(() => ++calls)(); await settle(); f.admission.cancel();
	await assert.rejects(Promise.resolve(old), { name: 'AbortError' });
	const next = f.admission.run(() => ++calls)(); f.publishMidi();
	assert.equal(await next, 1); assert.equal(calls, 1);
});

test('preparation captures its target before pure setup and preserves edits made during its wait', async () => {
	const f = fixture(), read = f.admission.beforeRead(); assert.ok(read); let gain = 0;
	const preparation = (async () => { gain = 1; await read(); return gain; })();
	assert.equal(gain, 1); gain = 2; f.publishMidi(); assert.equal(await preparation, 2);
});

test('a current MIDI settlement failure remains visible without invoking the consumer', async () => {
	const error = new Error('storage failed'); let calls = 0;
	const admission = createMidiPendingSnapshotAdmission({ hasPendingEdits: () => true,
		getProject: () => ({ id: 'project' }), captureTarget: () => '', active: () => true,
		settled: async () => { throw error; } });
	await assert.rejects(Promise.resolve(admission.run(() => ++calls)()), error); assert.equal(calls, 0);
});

test('a prepared snapshot receipt rejects publication between readiness and the actual PCM read', async () => {
	const f = fixture(), read = f.admission.beforeRead(); assert.ok(read);
	f.publishMidi(); const assertPrepared = await read(); assertPrepared();
	f.publishMidi();
	assert.throws(assertPrepared, { name: 'AbortError' });
});
