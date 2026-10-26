/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimePitchScrub } from '../src/common/editor/controller/transport/internal/time-pitch-scrub.ts';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

function fixture() {
	let project = { id: 'project' }, blocked = false, missing = false, resumes = 0, ended = 0;
	let prepare = async (_project: typeof project, _abort: AbortController) => {};
	const grains: number[] = [], seeks: number[] = [];
	const service = createTimePitchScrub({
		engine: { getPositionFrames: () => 17, async getAudioContext() { resumes++; },
			async scrub(frame) { grains.push(frame); return frame; }, seek(frame) { seeks.push(frame); return frame; }, endScrub() { ended++; } },
		getProject: () => project, blocked: () => blocked, assertSources: () => { if (missing) throw new Error('Missing media'); },
		normalizeFrame: frame => Math.max(0, Math.round(frame)), prepare: (owner, abort) => prepare(owner, abort),
	});
	return { service, grains, seeks, resumes: () => resumes, ended: () => ended,
		setPrepare(next: typeof prepare) { prepare = next; }, changeProject() { project = { ...project }; },
		block(value: boolean) { blocked = value; }, missing(value: boolean) { missing = value; } };
}

test('scrub resumes its context in the input event and coalesces moves behind one cache preparation', async () => {
	const f = fixture(), gate = deferred(); let preparations = 0;
	f.setPrepare(async () => { preparations++; await gate.promise; });
	const first = f.service.request(10);
	assert.equal(f.resumes(), 1, 'activation begins synchronously before any cache await');
	const latest = f.service.request(30.4);
	assert.equal(first, latest);
	await Promise.resolve(); assert.equal(preparations, 1); assert.deepEqual(f.grains, []);
	gate.resolve(); assert.equal(await first, 30); assert.deepEqual(f.grains, [30]);
	await f.service.request(50); assert.equal(preparations, 1); assert.deepEqual(f.grains, [30, 50]);
	f.service.end(); assert.equal(f.ended(), 1);
});

for (const phase of ['before-preparation', 'pending'] as const) test(`pointer release retires ${phase} without a late raw or processed grain`, async () => {
	const f = fixture(), gate = deferred(); let owned: AbortController | undefined;
	f.setPrepare(async (_project, abort) => { owned = abort; await gate.promise; });
	const pending = f.service.request(100);
	if (phase === 'pending') await Promise.resolve();
	f.service.end();
	if (owned) assert.equal(owned.signal.aborted, true);
	gate.resolve(); assert.equal(await pending, 17); assert.deepEqual(f.grains, []); assert.deepEqual(f.seeks, []);
});

test('a replacement project with the same ID owns only its new scrub request', async () => {
	const f = fixture(), old = deferred(), fresh = deferred(); let calls = 0;
	f.setPrepare(async () => { await (calls++ === 0 ? old : fresh).promise; });
	const first = f.service.request(10); await Promise.resolve(); f.changeProject();
	const next = f.service.request(80); await Promise.resolve();
	old.resolve(); assert.equal(await first, 17); assert.deepEqual(f.grains, []);
	fresh.resolve(); assert.equal(await next, 80); assert.deepEqual(f.grains, [80]);
});

test('genuine cache failures refuse the grain and a new gesture can retry', async () => {
	const f = fixture();
	f.setPrepare(async () => { throw new Error('Cache failure'); });
	await assert.rejects(Promise.resolve(f.service.request(100)), /Cache failure/);
	assert.deepEqual(f.grains, []); assert.deepEqual(f.seeks, []);
	f.setPrepare(async () => {}); assert.equal(await f.service.request(200), 200);
});

test('recording admission prevents preparation and retires a request that became blocked', async () => {
	const f = fixture(), gate = deferred();
	f.block(true); assert.equal(f.service.request(100), 17); assert.equal(f.resumes(), 0);
	f.block(false); f.setPrepare(async () => { await gate.promise; });
	const pending = f.service.request(100); await Promise.resolve(); f.block(true); gate.resolve();
	assert.equal(await pending, 17); assert.deepEqual(f.grains, []);
	f.block(false); assert.equal(await f.service.request(200), 200);
	f.missing(true); assert.throws(() => f.service.request(200), /Missing media/);
});

test('legacy engines without scrub retain direct normalized seek without cache work', () => {
	const project = {};
	const service = createTimePitchScrub({ engine: { getPositionFrames: () => 0, seek: frame => frame },
		getProject: () => project, blocked: () => false, assertSources() {}, normalizeFrame: Math.round,
		async prepare() { throw new Error('A legacy seek does not consume processed audio'); } });
	assert.equal(service.request(100.4), 100);
});
