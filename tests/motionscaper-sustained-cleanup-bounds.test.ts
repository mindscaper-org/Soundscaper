/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { shutdownMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-shutdown.ts';

const owner = { pid: 700001, parentPid: 1, startTicks: '101' };
const dependent = { pid: 700002, parentPid: owner.pid, startTicks: '102' };
type Options = Parameters<typeof shutdownMotionSustainedApplication>[0];
const never = new Promise<never>(() => undefined);
const flush = async () => { for (let count = 0; count < 50; count++) await Promise.resolve(); };
function options(overrides: Partial<Options> = {}): Options {
	return { owner, retained: () => [owner, dependent], prepare: async () => undefined,
		closed: Promise.resolve({ code: 0, signal: null }), isAlive: async () => true,
		send: () => undefined, signalUnadmitted: () => assert.fail('Foreign authority'), waitGone: async () => undefined, ...overrides };
}

test('Motion cleanup bounds never-settling preparation without a late TERM after ten-second KILL', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const sent: NodeJS.Signals[] = [];
	let result: Awaited<ReturnType<typeof shutdownMotionSustainedApplication>> | undefined;
	const operation = shutdownMotionSustainedApplication(options({ prepare: () => never,
		closed: never, send: (_identity, signal) => { sent.push(signal); } })).then(value => { result = value; });
	await flush(); t.mock.timers.tick(9999); await flush(); assert.equal(sent.length, 0);
	t.mock.timers.tick(1); await flush(); assert.deepEqual(sent, ['SIGKILL', 'SIGKILL']);
	t.mock.timers.tick(20000); await flush();
	assert.ok(result, 'Cleanup must settle as FAILED at its final bound.'); await operation;
	assert.equal(result.exit, null); assert.equal(result.physicalClosure, 'unknown');
	assert.ok(result.unresolved.includes('preparation')); assert.ok(result.unresolved.includes('owner-exit'));
	assert.ok(result.errors.length > 0); assert.equal(sent.includes('SIGTERM'), false);
});

test('Motion cleanup checks identity absence independently of a never-settling child close', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] }); let checked = 0;
	let result: Awaited<ReturnType<typeof shutdownMotionSustainedApplication>> | undefined;
	const operation = shutdownMotionSustainedApplication(options({ closed: never, waitGone: async identities => {
		checked++; assert.deepEqual(identities, [owner, dependent]);
	} })).then(value => { result = value; });
	await flush(); assert.equal(checked, 0); t.mock.timers.tick(10000); await flush();
	assert.equal(checked, 1); t.mock.timers.tick(20000); await flush();
	assert.ok(result, 'Missing child close must not hang cleanup.'); await operation;
	assert.equal(result.exit, null); assert.equal(result.physicalClosure, 'unknown');
	assert.ok(result.unresolved.includes('owner-exit')); assert.deepEqual(result.identities, [owner, dependent]);
});

test('Motion cleanup retains an actually observed exit even when preparation never drains', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let result: Awaited<ReturnType<typeof shutdownMotionSustainedApplication>> | undefined;
	const operation = shutdownMotionSustainedApplication(options({ prepare: () => never })).then(value => { result = value; });
	await flush(); t.mock.timers.tick(30000); await flush();
	assert.ok(result, 'Preparation must not hide a known child exit.'); await operation;
	assert.deepEqual(result.exit, { code: 0, signal: null }); assert.equal(result.physicalClosure, 'unknown');
	assert.ok(result.unresolved.includes('preparation')); assert.ok(result.errors.length > 0);
});

for (const blocked of ['isAlive', 'send', 'waitGone'] as const) {
	test(`Motion cleanup bounds a never-settling ${blocked} including escalation and retains unresolved custody`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0;
		const override = blocked === 'isAlive' ? { isAlive: () => { calls++; return never; } }
			: blocked === 'send' ? { send: () => { calls++; return never; } } : { waitGone: () => { calls++; return never; } };
		let result: Awaited<ReturnType<typeof shutdownMotionSustainedApplication>> | undefined;
		const operation = shutdownMotionSustainedApplication(options(override)).then(value => { result = value; });
		await flush(); t.mock.timers.tick(10000); await flush(); t.mock.timers.tick(20000); await flush();
		assert.ok(result, `${blocked} must not defeat the cleanup deadline.`); await operation;
		assert.equal(result.physicalClosure, 'unknown'); assert.ok(result.unresolved.length > 0);
		assert.ok(result.errors.length > 0); assert.deepEqual(result.identities, [owner, dependent]);
		const atRetirement = calls; await flush(); assert.equal(calls, atRetirement);
	});
}

test('Motion cleanup never resumes signalling from an identity check resolved after retirement', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] }); let release!: (value: boolean) => void;
	const alive = new Promise<boolean>(resolve => { release = resolve; }); const sent: NodeJS.Signals[] = [];
	let result: Awaited<ReturnType<typeof shutdownMotionSustainedApplication>> | undefined;
	const operation = shutdownMotionSustainedApplication(options({ isAlive: () => alive,
		send: (_identity, signal) => { sent.push(signal); } })).then(value => { result = value; });
	await flush(); t.mock.timers.tick(10000); await flush(); t.mock.timers.tick(20000); await flush();
	assert.ok(result, 'Unresolved identity read must return a FAILED receipt.'); await operation;
	release(true); await flush(); assert.deepEqual(sent, []); assert.equal(result.physicalClosure, 'unknown');
});

test('Motion cleanup never sends a delayed TERM after the original ten-second escalation', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] }); let release!: (value: boolean) => void; let first = true;
	const delayed = new Promise<boolean>(resolve => { release = resolve; }); const sent: NodeJS.Signals[] = [];
	const operation = shutdownMotionSustainedApplication(options({ isAlive: () => {
		if (first) { first = false; return delayed; } return Promise.resolve(true);
	}, send: (_identity, signal) => { sent.push(signal); } }));
	await flush(); t.mock.timers.tick(10000); await flush(); assert.deepEqual(sent, ['SIGKILL', 'SIGKILL']);
	release(true); const result = await operation;
	assert.equal(sent.includes('SIGTERM'), false); assert.ok(result.errors.some(error => String(error).includes('escalation deadline')));
});
