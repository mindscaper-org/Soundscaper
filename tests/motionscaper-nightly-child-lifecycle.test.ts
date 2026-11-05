/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
import test, { type TestContext } from 'node:test';

import { runDesktopNightlyTestsPlaywrightChild } from '../scripts/lib/desktop-nightly-tests-playwright-child.mjs';
import { DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER } from '../scripts/lib/desktop-nightly-tests-progress-reporter.mjs';

type Result = { code: number | null; signal: string | null };
type Outcome = { state: 'pending' } | { state: 'fulfilled'; value: Result } | { state: 'rejected'; error: unknown };
type SpawnCall = { command: unknown; args: unknown; options: unknown };

class FakeChild extends EventEmitter {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly signals: (NodeJS.Signals | undefined)[] = [];
	pid: number | undefined;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	killed = false;
	exited = false;
	closed = false;
	unrefs = 0;
	constructor(pid: number) { super(); this.pid = pid; }
	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean { this.signals.push(signal); this.killed = true; return true; }
	unref(): void { this.unrefs++; }
	exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
		if (this.exited) return;
		this.exited = true;
		this.exitCode = code; this.signalCode = signal; this.emit('exit', code, signal);
	}
	close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
		if (this.closed) return;
		this.closed = true; this.stdout.end(); this.stderr.end(); this.exit(code, signal);
		this.emit('close', code, signal);
	}
}

class FakeLog extends Writable {
	readonly chunks: Buffer[] = [];
	finalFailure: Error | undefined;
	override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.chunks.push(Buffer.from(chunk)); callback();
	}
	override _final(callback: (error?: Error | null) => void): void { callback(this.finalFailure); }
}

const progress = `${DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER}{"completed":0,"total":1,"label":"Motion fixture"}\n`;
const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

function fixture(context: TestContext) {
	const child = new FakeChild(700_001);
	const log = new FakeLog();
	const calls: SpawnCall[] = [];
	const operations: Promise<void>[] = [];
	let spawnFailure: Error | undefined;
	context.mock.method(childProcess, 'spawn', (...args: unknown[]) => {
		calls.push({ command: args[0], args: args[1], options: args[2] });
		assert.equal(calls.length, 1, 'Cleanup must use only the original ChildProcess handle.');
		if (spawnFailure) throw spawnFailure;
		return child;
	});
	context.mock.method(fs, 'open', (path: unknown, flags: unknown) => {
		assert.equal(path, '/synthetic/motion-child.log'); assert.equal(flags, 'wx');
		return Promise.resolve({ createWriteStream: () => log });
	});
	syncBuiltinESMExports();
	context.after(async () => {
		child.close();
		context.mock.timers.tick(1_001);
		await Promise.all(operations);
		context.mock.restoreAll(); syncBuiltinESMExports();
	});
	context.mock.timers.enable({ apis: ['setTimeout'] });
	return {
		child, log, calls,
		failSpawn(error: Error): void { spawnFailure = error; },
		start(onItems?: () => void) {
			let outcome: Outcome = { state: 'pending' };
			const completed = runDesktopNightlyTestsPlaywrightChild({
				command: '/synthetic/node', args: ['playwright.mjs'], cwd: '/synthetic',
				env: { FIXTURE: 'motion' }, logFile: '/synthetic/motion-child.log',
			}, onItems).then((value: Result) => { outcome = { state: 'fulfilled', value }; },
				(error: unknown) => { outcome = { state: 'rejected', error }; });
			operations.push(completed);
			return { completed, outcome: () => outcome };
		},
	};
}

function rejectedWith(outcome: Outcome, error: Error): void {
	assert.equal(outcome.state, 'rejected');
	if (outcome.state === 'rejected') assert.equal(outcome.error, error, 'The first failure must retain its identity.');
}

test('Motion nightly log failure retains the child close waiter and first error', async context => {
	const f = fixture(context); const primary = new Error('log device unavailable');
	const operation = f.start(); await turn();
	f.log.emit('error', primary); await turn();
	assert.equal(operation.outcome().state, 'pending', 'A log error cannot abandon a running child.');
	assert.ok(f.child.listenerCount('close') > 0);
	f.child.close(null, 'SIGTERM'); await operation.completed;
	rejectedWith(operation.outcome(), primary); assert.equal(f.child.unrefs, 0);
});

test('Motion nightly asynchronous child error awaits physical close', async context => {
	const f = fixture(context); const primary = new Error('child channel failed');
	const operation = f.start(); await turn();
	f.child.emit('error', primary); await turn();
	assert.equal(operation.outcome().state, 'pending', 'An error event is not physical process closure.');
	f.child.close(1); await operation.completed; rejectedWith(operation.outcome(), primary);
});

test('Motion nightly observer failure escalates an ignored TERM after 250ms and stops further parsing', async context => {
	const f = fixture(context); const primary = new Error('observer failed'); let updates = 0;
	const operation = f.start(() => { updates++; throw primary; }); await turn();
	f.child.stdout.write(progress); f.child.stdout.write(progress); await turn();
	assert.equal(updates, 1); assert.equal(operation.outcome().state, 'pending');
	assert.equal(Reflect.get(f.calls[0]!.options as object, 'detached'), false);
	assert.deepEqual(f.child.signals, ['SIGTERM']);
	assert.equal(f.child.killed, true, 'Signal delivery does not prove that the child exited.');
	assert.equal(f.child.exitCode, null); assert.equal(f.child.signalCode, null);
	context.mock.timers.tick(249); assert.deepEqual(f.child.signals, ['SIGTERM']);
	context.mock.timers.tick(1);
	assert.deepEqual(f.child.signals, ['SIGTERM', 'SIGKILL']);
	assert.equal(operation.outcome().state, 'pending', 'Escalation is not a close notification.');
	f.child.close(null, 'SIGKILL'); await operation.completed;
	rejectedWith(operation.outcome(), primary); assert.equal(f.child.unrefs, 0);
});

test('Motion nightly exit alone never settles while inherited output remains open', async context => {
	const f = fixture(context); const primary = new Error('observer failed before exit');
	const operation = f.start(() => { throw primary; }); await turn();
	f.child.stdout.write(progress); f.child.exit(null, 'SIGTERM');
	const signalsBeforeExit = [...f.child.signals];
	context.mock.timers.tick(1_001); await turn();
	assert.deepEqual(f.child.signals, signalsBeforeExit, 'Never target a numeric replacement after the original child exits.');
	assert.equal(operation.outcome().state, 'pending', 'Leader exit cannot stand in for pipe/child close.');
	assert.equal(f.child.unrefs, 0);
	f.child.close(null, 'SIGKILL'); await operation.completed; rejectedWith(operation.outcome(), primary);
});

test('Motion nightly synchronous spawn failure is not masked by log finalization', async context => {
	const f = fixture(context); const primary = new Error('spawn refused');
	f.failSpawn(primary); f.log.finalFailure = new Error('log finalization also failed');
	const operation = f.start(); await operation.completed;
	rejectedWith(operation.outcome(), primary);
});

test('Motion nightly observer failure is not masked by log finalization', async context => {
	const f = fixture(context); const primary = new Error('observer is the primary failure');
	f.log.finalFailure = new Error('secondary log finalization failure');
	const operation = f.start(() => { throw primary; }); await turn();
	f.child.stdout.write(progress); f.child.close(null, 'SIGTERM'); await operation.completed;
	rejectedWith(operation.outcome(), primary);
});

test('Motion nightly spawn error with no PID waits close without attempting numeric process termination', async context => {
	const f = fixture(context); const primary = new Error('ENOENT');
	const operation = f.start(); await turn(); f.child.pid = undefined;
	f.child.emit('error', primary); await turn();
	assert.equal(operation.outcome().state, 'pending');
	context.mock.timers.tick(1_001);
	assert.deepEqual(f.child.signals, []);
	f.child.close(-2); await operation.completed; rejectedWith(operation.outcome(), primary);
});

test('Motion nightly first error survives secondary child and log errors before close', async context => {
	const f = fixture(context); const primary = new Error('first log failure');
	const operation = f.start(); await turn();
	f.log.emit('error', primary);
	assert.doesNotThrow(() => f.child.emit('error', new Error('secondary child error')));
	assert.doesNotThrow(() => f.log.emit('error', new Error('secondary log error')));
	await turn(); assert.equal(operation.outcome().state, 'pending');
	f.child.close(null, 'SIGTERM'); await operation.completed;
	rejectedWith(operation.outcome(), primary);
});

test('Motion nightly successful child still reports a failed log finalization', async context => {
	const f = fixture(context); const primary = new Error('final log write failed');
	f.log.finalFailure = primary;
	const operation = f.start(); await turn();
	f.child.close(0); await operation.completed;
	rejectedWith(operation.outcome(), primary);
});

test('Motion nightly successful closure preserves complete stdout, stderr and progress without termination', async context => {
	const f = fixture(context); let updates = 0;
	const operation = f.start(() => { updates++; }); await turn();
	f.child.stdout.write(`normal console\n${progress}`); f.child.stderr.write('diagnostic\n');
	f.child.close(0); await operation.completed;
	assert.deepEqual(operation.outcome(), { state: 'fulfilled', value: { code: 0, signal: null } });
	assert.equal(updates, 1);
	assert.equal(Buffer.concat(f.log.chunks).toString('utf8'), `normal console\n${progress}diagnostic\n`);
	assert.equal(f.log.writableFinished, true);
	assert.deepEqual(f.child.signals, []); assert.equal(f.calls.length, 1);
});
