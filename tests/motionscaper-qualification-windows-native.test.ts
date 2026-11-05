/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { runMotionQualificationCommand } from '../desktop/motionscaper-qualification-command.ts';
import { createMotionQualificationNative, type MotionNativeLaunch } from '../desktop/motionscaper-qualification-native.ts';

interface NativeClosure {
	readonly physicalClosed: boolean;
	readonly exitCode: number;
	readonly timedOut: boolean;
	readonly failure: string | null;
	readonly details: {
		readonly outcome: string;
		readonly naturalClosure: boolean;
		readonly ownershipResolved: boolean;
		readonly stdoutClosed: boolean;
		readonly stderrClosed: boolean;
		readonly accounting: { readonly activeProcesses: number };
		readonly survivorsAfterCleanup: readonly unknown[];
	};
}
const nativeOnly = { skip: process.platform !== 'win32', timeout: 60000 };
const root = resolve(import.meta.dirname, '..');

async function readClosure(directory: string, id: string): Promise<NativeClosure> {
	const value: unknown = JSON.parse(await readFile(join(directory, `${id}.closure.json`), 'utf8'));
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as NativeClosure;
}
function assertPhysicalClosure(closure: NativeClosure): void {
	assert.equal(closure.physicalClosed, true);
	assert.equal(closure.details.ownershipResolved, true);
	assert.equal(closure.details.stdoutClosed, true);
	assert.equal(closure.details.stderrClosed, true);
	assert.equal(closure.details.accounting.activeProcesses, 0);
	assert.deepEqual(closure.details.survivorsAfterCleanup, []);
}
async function fixtureDirectory(context: TestContext, ids: readonly string[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-win-native-'));
	context.after(async () => {
		const closures = await Promise.all(ids.map(id => readClosure(directory, id))).catch(() => null);
		if (closures?.length && closures.every(value => value.physicalClosed && value.details.ownershipResolved
			&& value.details.accounting.activeProcesses === 0)) await rm(directory, { recursive: true });
		else context.diagnostic(`Native qualification runtime retained because physical closure is unproven: ${directory}`);
	});
	return directory;
}

test('Windows native commands preserve exact UTF-8 argv and retain unique successful physical receipts', nativeOnly, async context => {
	const ids = ['native-first', 'native-second'];
	const directory = await fixtureDirectory(context, ids);
	const values = ['a space', 'quote"literal', 'back\\slash', 'unicode-ä'];
	const invoke = (id: string) => runMotionQualificationCommand({ command: process.execPath,
		args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...values],
		cwd: root, directory, id, timeoutMs: 10000 });
	const first = await invoke(ids[0]!), second = await invoke(ids[1]!);
	assert.deepEqual(JSON.parse(first.stdout) as unknown, values);
	assert.deepEqual(JSON.parse(second.stdout) as unknown, values);
	assert.notEqual(first.receipt.path, second.receipt.path);
	for (const id of ids) {
		const closure = await readClosure(directory, id);
		assertPhysicalClosure(closure);
		assert.equal(closure.exitCode, 0);
		assert.equal(closure.failure, null);
		assert.equal(closure.details.naturalClosure, true);
	}
});

test('Windows native commands reject a natural nonzero child while proving its job and pipes closed', nativeOnly, async context => {
	const id = 'native-nonzero', directory = await fixtureDirectory(context, [id]);
	await assert.rejects(runMotionQualificationCommand({ command: process.execPath, args: ['-e', 'process.exit(7)'],
		cwd: root, directory, id, timeoutMs: 10000 }), /Native qualification command failed/u);
	const closure = await readClosure(directory, id);
	assertPhysicalClosure(closure);
	assert.equal(closure.exitCode, 7);
	assert.equal(closure.timedOut, false);
	assert.equal(closure.details.naturalClosure, true);
});

test('Windows native deadlines reject the command and physically drain its retained job', nativeOnly, async context => {
	const id = 'native-timeout', directory = await fixtureDirectory(context, [id]);
	await assert.rejects(runMotionQualificationCommand({ command: process.execPath,
		args: ['-e', 'setTimeout(() => {}, 30000)'], cwd: root, directory, id, timeoutMs: 250 }), /Native qualification command failed/u);
	const closure = await readClosure(directory, id);
	assertPhysicalClosure(closure);
	assert.equal(closure.timedOut, true);
	assert.equal(closure.details.outcome, 'timeout');
	assert.equal(closure.details.naturalClosure, false);
});

test('Windows native metadata preserves a real Unicode executable path before caller-EOF cleanup', nativeOnly, async context => {
	const id = 'native-unicode', directory = await fixtureDirectory(context, [id]);
	const unicode = join(directory, 'unicode-ä'); await mkdir(unicode);
	const executable = join(unicode, 'PING.EXE');
	assert.ok(process.env.SystemRoot, 'A genuine Windows SystemRoot is required.');
	await copyFile(join(process.env.SystemRoot, 'System32', 'PING.EXE'), executable);
	const retained: { launch?: MotionNativeLaunch } = {};
	context.after(async () => {
		const launch = retained.launch;
		if (launch) {
			launch.child.stdin.end();
			await launch.closed;
		}
	});
	const native = await createMotionQualificationNative(root, directory);
	const launch = await native.start({ executable, args: ['-n', '30', '127.0.0.1'], cwd: root,
		id, timeoutMs: 30000, maximumOutputBytes: 65536, env: process.env });
	retained.launch = launch;
	launch.child.stdin.on('error', () => { /* The retained controller closure is checked below. */ });
	launch.child.stdout.resume(); launch.child.stderr.resume();
	const { owner, controller } = await launch.admitted;
	const identityKeys = ['birth', 'executable', 'parent', 'pid', 'platform'];
	assert.deepEqual(Object.keys(owner).sort(), identityKeys);
	assert.ok(controller); assert.deepEqual(Object.keys(controller).sort(), identityKeys);
	const actual = await native.inspect(owner.pid);
	assert.equal(actual?.executable, owner.executable);
	assert.ok(actual?.executable.includes('unicode-ä'));
	assert.equal(actual?.birth, owner.birth);
	launch.child.stdin.end();
	const terminal = await launch.closed;
	assert.equal(terminal.code, 125);
	assert.equal(terminal.signal, null);
	const closure = await readClosure(directory, id);
	assertPhysicalClosure(closure);
	assert.equal(closure.details.outcome, 'parent-eof');
	assert.equal(closure.details.naturalClosure, false);
	const retired = await native.inspect(owner.pid);
	assert.ok(!retired || retired.birth !== owner.birth);
});

test('Windows owned signal projects an actual rich inspection before the unchanged UIAutomation refusal', nativeOnly, async context => {
	const id = 'native-signal-identity', directory = await fixtureDirectory(context, [id]);
	assert.ok(process.env.SystemRoot, 'A genuine Windows SystemRoot is required.');
	const native = await createMotionQualificationNative(root, directory);
	const launch = await native.start({ executable: join(process.env.SystemRoot, 'System32', 'PING.EXE'),
		args: ['-n', '30', '127.0.0.1'], cwd: root, id, timeoutMs: 30000, maximumOutputBytes: 65536, env: process.env });
	context.after(async () => { launch.child.stdin.end(); await launch.closed; });
	launch.child.stdin.on('error', () => { /* The actual retained controller closure is checked below. */ });
	launch.child.stdout.resume(); launch.child.stderr.resume();
	const { owner, custody } = await launch.admitted;
	const actual = await native.inspect(owner.pid); assert.ok(actual);
	assert.equal(actual.state, 'running');
	const original = { ...actual };
	// PING has no owned GUI window: identity admission must reach the existing refusal, never TERM another process.
	await assert.rejects(native.signal(actual, custody, 'TERM'),
		/No owned UIAutomation window supports TERM; explicit owned-job KILL is required\.|Owned UIAutomation TERM is unavailable without an interactive desktop\./u);
	assert.deepEqual(actual, original, 'Authority serialization must preserve the rich process observation.');
	const requests: { action: string; owner?: unknown }[] = [];
	for (const name of await readdir(directory)) if (/^native-request-\d+\.json$/u.test(name)) {
		requests.push(JSON.parse(await readFile(join(directory, name), 'utf8')) as { action: string; owner?: unknown });
	}
	const signals = requests.filter(request => request.action === 'signal'); assert.equal(signals.length, 1);
	assert.deepEqual(signals[0]!.owner, owner);
	assert.deepEqual(Object.keys(signals[0]!.owner as object).sort(), ['birth', 'executable', 'parent', 'pid', 'platform']);
	assert.equal((await native.inspect(owner.pid))?.birth, owner.birth, 'The expected TERM refusal leaves the owned PING alive for caller-EOF cleanup.');
	launch.child.stdin.end();
	const terminal = await launch.closed; assert.deepEqual(terminal, { code: 125, signal: null });
	const closure = await readClosure(directory, id); assertPhysicalClosure(closure);
	assert.equal(closure.details.outcome, 'parent-eof'); assert.equal(closure.details.naturalClosure, false);
	const retired = await native.inspect(owner.pid); assert.ok(!retired || retired.birth !== owner.birth);
});
