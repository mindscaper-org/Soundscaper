/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionDesktopQuitOwner } from '../desktop/motionscaper-quit.ts';

function deferred() {
	let resolve!: () => void, reject!: (error: unknown) => void;
	const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}
function quitEvent() {
	let prevented = 0;
	return { preventDefault() { prevented++; }, get prevented() { return prevented; } };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('Motion quit holds repeated events until launch, file and encoder cleanup all settle', async context => {
	const launch = deferred(), file = deferred(), encoder = deferred(), fileStarted = deferred();
	context.after(() => { launch.resolve(); file.resolve(); encoder.resolve(); });
	const calls: string[] = [], finalEvent = quitEvent();
	let reentry: Promise<void> | undefined;
	const owner = new MotionDesktopQuitOwner({
		disposeLaunches: async () => { calls.push('launch'); await launch.promise; },
		disposeFiles: async () => { calls.push('files'); fileStarted.resolve(); await file.promise; },
		disposeDelivery: async () => { calls.push('encoder'); await encoder.promise; },
		quit: () => { calls.push('quit'); reentry = owner.beforeQuit(finalEvent); },
		reportFailure: () => assert.fail('Successful physical cleanup must not report a failure.'),
	});
	const firstEvent = quitEvent(), secondEvent = quitEvent();
	const first = owner.beforeQuit(firstEvent), second = owner.beforeQuit(secondEvent);
	assert.equal(first, second);
	assert.equal(firstEvent.prevented, 1); assert.equal(secondEvent.prevented, 1);
	await tick(); assert.deepEqual(calls, ['launch', 'encoder']);
	launch.resolve(); await fileStarted.promise;
	assert.deepEqual(calls, ['launch', 'encoder', 'files']);
	const thirdEvent = quitEvent(); assert.equal(owner.beforeQuit(thirdEvent), first); assert.equal(thirdEvent.prevented, 1);
	file.resolve(); await tick(); assert.equal(calls.includes('quit'), false);
	encoder.resolve(); await first; await reentry;
	assert.deepEqual(calls, ['launch', 'encoder', 'files', 'quit']);
	assert.equal(finalEvent.prevented, 0);
	await owner.beforeQuit(quitEvent()); assert.equal(calls.filter(value => value === 'quit').length, 1);
});

test('Motion quit still closes files after launch failure and waits for every failure before reporting', async context => {
	const launch = deferred(), file = deferred(), encoder = deferred(), fileStarted = deferred();
	context.after(() => { launch.resolve(); file.resolve(); encoder.resolve(); });
	const launchError = new Error('Launch capability revoke failed.'), fileError = new Error('File close failed.'), encoderError = new Error('Encoder close failed.');
	const calls: string[] = [], reports: unknown[] = [];
	const owner = new MotionDesktopQuitOwner({
		disposeLaunches: () => launch.promise,
		disposeFiles: async () => { calls.push('files'); fileStarted.resolve(); await file.promise; },
		disposeDelivery: () => encoder.promise,
		quit: () => calls.push('quit'), reportFailure: error => reports.push(error),
	});
	const complete = owner.beforeQuit(quitEvent()); await tick();
	launch.reject(launchError); await fileStarted.promise;
	assert.equal(reports.length, 0); assert.deepEqual(calls, ['files']);
	file.reject(fileError); await tick(); assert.equal(reports.length, 0);
	const repeated = quitEvent(); assert.equal(owner.beforeQuit(repeated), complete); assert.equal(repeated.prevented, 1);
	encoder.reject(encoderError); await complete;
	assert.equal(reports.length, 1); assert.ok(reports[0] instanceof AggregateError);
	assert.deepEqual(reports[0].errors, [launchError, fileError, encoderError]);
	assert.equal(calls.includes('quit'), false);
	const failedEvent = quitEvent(); await owner.beforeQuit(failedEvent);
	assert.equal(failedEvent.prevented, 1); assert.equal(reports.length, 1); assert.deepEqual(calls, ['files']);
});

test('Motion quit captures synchronous cleanup errors without skipping other authorities or starting twice', async () => {
	const calls: string[] = [], reports: unknown[] = [], reentrant = quitEvent();
	const error = new Error('Synchronous launch cleanup failure.');
	let nested: Promise<void> | undefined;
	const owner = new MotionDesktopQuitOwner({
		disposeLaunches: () => { calls.push('launch'); nested = owner.beforeQuit(reentrant); throw error; },
		disposeFiles: () => { calls.push('files'); }, disposeDelivery: () => { calls.push('encoder'); },
		quit: () => calls.push('quit'), reportFailure: failure => reports.push(failure),
	});
	const complete = owner.beforeQuit(quitEvent()); await complete; await nested;
	assert.equal(nested, complete); assert.equal(reentrant.prevented, 1);
	assert.deepEqual(calls.sort(), ['encoder', 'files', 'launch']);
	assert.equal(reports.length, 1); assert.ok(reports[0] instanceof AggregateError); assert.deepEqual(reports[0].errors, [error]);
});

test('Successor quit without a launch authority still waits for files and delivery', async context => {
	const file = deferred(), encoder = deferred(); context.after(() => { file.resolve(); encoder.resolve(); });
	let quits = 0;
	const owner = new MotionDesktopQuitOwner({ disposeFiles: () => file.promise, disposeDelivery: () => encoder.promise,
		quit: () => { quits++; }, reportFailure: () => assert.fail('Successful successor cleanup must not report a failure.') });
	const complete = owner.beforeQuit(quitEvent()); file.resolve(); await tick(); assert.equal(quits, 0);
	const repeated = quitEvent(); assert.equal(owner.beforeQuit(repeated), complete); assert.equal(repeated.prevented, 1);
	encoder.resolve(); await complete; assert.equal(quits, 1);
});

test('Motion quit keeps the barrier held and logs both failures when displaying cleanup failure throws', async context => {
	const cleanupError = new Error('File close failed.'), reportingError = new Error('Native error dialog failed.');
	const logs: unknown[][] = []; context.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values); });
	let reports = 0, quits = 0;
	const owner = new MotionDesktopQuitOwner({ disposeFiles: () => { throw cleanupError; }, disposeDelivery: () => undefined,
		quit: () => { quits++; }, reportFailure: () => { reports++; throw reportingError; } });
	const complete = owner.beforeQuit(quitEvent()); await complete;
	assert.equal(quits, 0); assert.equal(reports, 1); assert.equal(logs.length, 1);
	const logged = logs[0]![0]; assert.ok(logged instanceof AggregateError);
	const cleanup = logged.errors[0] as unknown; assert.ok(cleanup instanceof AggregateError);
	assert.deepEqual(cleanup.errors, [cleanupError]); assert.equal(logged.errors[1], reportingError);
	const repeated = quitEvent(); assert.equal(owner.beforeQuit(repeated), complete); await complete;
	assert.equal(repeated.prevented, 1); assert.equal(reports, 1); assert.equal(logs.length, 1);
});
