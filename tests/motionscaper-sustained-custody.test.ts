/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionSustainedProcessCustody } from '../scripts/performance/motionscaper-sustained-custody.ts';

const identity = (index: number) => ({ pid: 700000 + index, parentPid: 1, startTicks: String(index + 1) });
const flush = async () => { for (let count = 0; count < 20; count++) await Promise.resolve(); };

test('Motion custody bounds historical identities and retains the complete first overflow snapshot', () => {
	const custody = new MotionSustainedProcessCustody();
	for (let offset = 0; offset < 4096; offset += 64) custody.retain(Array.from({ length: 64 }, (_, index) => identity(offset + index)));
	custody.retain(Array.from({ length: 4096 }, (_, index) => identity(index)));
	custody.retain([identity(0)]); assert.equal(custody.identities().length, 4096);
	const current = Array.from({ length: 64 }, (_, index) => identity(4096 + index));
	assert.throws(() => custody.retain(current), /cumulative process identity admission exceeded/u);
	assert.deepEqual(custody.identities(), Array.from({ length: 4160 }, (_, index) => identity(index)));
	const failure = custody.failure(); assert.ok(failure);
	assert.throws(() => custody.retain([identity(9000)]), error => error === failure);
	assert.equal(custody.identities().length, 4160, 'A failed run cannot admit another census.');
});

test('Motion custody serializes discovery and refuses a queued census after the first overflows', async () => {
	const custody = new MotionSustainedProcessCustody(2, 2); custody.retain([identity(0), identity(1)]);
	let release!: () => void;
	const blocked = new Promise<void>(resolve => { release = resolve; }); let started = 0;
	const first = custody.observe(async () => { started++; await blocked; custody.retain([identity(2), identity(3)]); });
	const firstFailed = assert.rejects(first, /cumulative process identity admission exceeded/u);
	const second = custody.observe(async () => { started++; custody.retain([identity(4)]); });
	const secondFailed = assert.rejects(second, /cumulative process identity admission exceeded/u);
	await flush(); assert.equal(started, 1); release(); await Promise.all([firstFailed, secondFailed]);
	assert.equal(started, 1); assert.deepEqual(custody.identities(), [identity(0), identity(1), identity(2), identity(3)]);
});

test('Motion custody closes ordinary admission before its one serialized final census', async () => {
	const custody = new MotionSustainedProcessCustody(4, 2); let release!: () => void;
	const blocked = new Promise<void>(resolve => { release = resolve; }); const order: string[] = [];
	const first = custody.observe(async () => { order.push('active'); await blocked; custody.retain([identity(0)]); });
	await flush();
	const queued = custody.observe(async () => { order.push('queued'); });
	const queuedFailed = assert.rejects(queued, /observation admission is closed/u);
	const final = custody.finish(async () => { order.push('final'); custody.retain([identity(1)]); });
	const lateFailed = assert.rejects(custody.observe(async () => { order.push('late'); }), /observation admission is closed/u);
	await flush(); assert.deepEqual(order, ['active']); release();
	await Promise.all([first, queuedFailed, final, lateFailed]);
	assert.deepEqual(order, ['active', 'final']); assert.deepEqual(custody.identities(), [identity(0), identity(1)]);
	await assert.rejects(custody.finish(async () => assert.fail('Second final census')), /observation admission is closed/u);
});

test('Motion custody does not discover another snapshot after failed admission, including cleanup', async () => {
	const custody = new MotionSustainedProcessCustody(1, 2); custody.retain([identity(0)]);
	assert.throws(() => custody.retain([identity(1), identity(2)]), /cumulative process identity admission exceeded/u);
	let started = 0;
	await assert.rejects(custody.finish(async () => { started++; }), error => error === custody.failure());
	assert.equal(started, 0); assert.deepEqual(custody.identities(), [identity(0), identity(1), identity(2)]);
});

test('Motion custody bounds queued admissions while retaining the current in-flight snapshot on refusal', async () => {
	const custody = new MotionSustainedProcessCustody(); let release!: () => void; let started = 0;
	const blocked = new Promise<void>(resolve => { release = resolve; });
	const active = custody.observe(async () => { started++; await blocked; custody.retain([identity(0), identity(1)]); });
	const failures: Promise<void>[] = [assert.rejects(active, /census queue admission exceeded/u)];
	await flush();
	for (let count = 0; count < 64; count++) failures.push(assert.rejects(custody.observe(async () => { started++; }), /census queue admission exceeded/u));
	await assert.rejects(custody.observe(async () => { started++; }), /census queue admission exceeded/u);
	assert.equal(custody.state().pending, 65); release(); await Promise.all(failures);
	assert.equal(started, 1); assert.equal(custody.state().pending, 0);
	assert.deepEqual(custody.identities(), [identity(0), identity(1)]);
	assert.equal(custody.state().futureBirths, 'unobserved');
});

test('Motion custody explicitly refuses an unadmitted snapshot outside the existing 64-process reader contract', async () => {
	const custody = new MotionSustainedProcessCustody(); custody.retain([identity(0)]);
	assert.throws(() => custody.retain(Array.from({ length: 65 }, (_, index) => identity(index + 1))), /unadmitted process snapshot/u);
	assert.deepEqual(custody.identities(), [identity(0)], 'All previously admitted custody remains; an oversized snapshot is not admitted.');
	assert.ok(custody.failure()); assert.equal(custody.state().futureBirths, 'unobserved');
	await assert.rejects(custody.observe(async () => assert.fail('No new census after refusal')), error => error === custody.failure());
});
