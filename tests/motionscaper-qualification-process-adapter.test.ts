/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createMotionQualificationNative } from '../desktop/motionscaper-qualification-native.ts';
import { motionQualificationProcessIdentity, type MotionQualificationOwner } from '../desktop/motionscaper-qualification-policy.ts';
import { selectMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-process.ts';

test('Native process adaptation retains descendants and orphan births while refusing recycled PIDs', () => {
	const owner = (pid: number, parent: number, birth: string): MotionQualificationOwner => ({
		platform: 'linux', pid, parent, birth, executable: '/owned/application',
	});
	const root = owner(20, 1, '100'), child = owner(21, 20, '101'), orphan = owner(22, 1, '102');
	const old = owner(23, 20, '103'), recycled = owner(23, 1, '104'), foreign = owner(24, 999, '105');
	const selected = selectMotionOwnedProcesses([root, child, orphan, recycled, foreign].map(motionQualificationProcessIdentity),
		motionQualificationProcessIdentity(root), [orphan, old].map(motionQualificationProcessIdentity));
	assert.deepEqual(selected.map(value => value.pid), [20, 21, 22]);
});

test('Linux qualification observer retains the actual process parent and executable identity', { skip: process.platform !== 'linux' }, async context => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'motion-native-observer-')));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const native = await createMotionQualificationNative(resolve(import.meta.dirname, '..'), directory);
	const current = await native.inspect(process.pid);
	assert.ok(current);
	assert.equal(current.pid, process.pid);
	assert.equal(current.parent, process.ppid);
	assert.equal(current.executable, await realpath(process.execPath));
	assert.match(current.birth, /^[1-9]\d*$/u);
});

const child: MotionQualificationOwner = { platform: 'linux', pid: 700021, parent: 700020, birth: '301', executable: '/owned/application' };
const linuxOnly = { skip: process.platform !== 'linux' };
function processStat(state = 'S', birth = child.birth, parent = child.parent): string {
	const fields = [state, String(parent), String(child.parent), String(child.parent), ...Array<string>(15).fill('0'), birth];
	return `${child.pid} (qualification child) ${fields.join(' ')}\n`;
}
function procError(code: string): Error { return Object.assign(new Error(`${code}: synthetic /proc read`), { code }); }
async function observer(context: TestContext, readStat: () => string, readExecutable: () => string,
	readNames: () => readonly string[] | Promise<readonly string[]> = () => [String(child.pid)]) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'motion-native-race-')));
	context.after(async () => { context.mock.restoreAll(); syncBuiltinESMExports(); await rm(directory, { recursive: true, force: true }); });
	const native = await createMotionQualificationNative(resolve(import.meta.dirname, '..'), directory);
	context.mock.method(fs.promises, 'readFile', (path: fs.PathLike, encoding: unknown) => {
		assert.equal(path, `/proc/${child.pid}/stat`); assert.equal(encoding, 'utf8');
		return Promise.resolve().then(readStat);
	});
	context.mock.method(fs.promises, 'readlink', (path: fs.PathLike) => {
		assert.equal(path, `/proc/${child.pid}/exe`); return Promise.resolve().then(readExecutable);
	});
	context.mock.method(fs.promises, 'readdir', (path: fs.PathLike) => {
		assert.equal(path, '/proc'); return Promise.resolve().then(readNames);
	});
	syncBuiltinESMExports();
	return { native, directory };
}

for (const [state, code] of [['Z', 'ENOENT'], ['X', 'ESRCH']] as const) {
	test(`Linux census-admitted child retains its exact identity in ${state} until physical disappearance`, linuxOnly, async context => {
		let terminal = false, absent = false;
		const { native, directory } = await observer(context, () => {
			if (absent) throw procError(code);
			return processStat(terminal ? state : 'S', child.birth, terminal ? 1 : child.parent);
		}, () => { if (terminal) throw procError(code); return child.executable; });
		const snapshot = await native.snapshot();
		assert.deepEqual(snapshot.processes, [{ ...child, group: child.parent, session: child.parent, state: 'running' }]);
		terminal = true;
		const retired = await native.inspect(child.pid);
		assert.deepEqual(retired, { ...snapshot.processes[0], parent: 1, state: 'zombie' });
		const kill = context.mock.method(process, 'kill', () => { throw new Error('A visible zombie must never be signalled.'); });
		await native.signal(child, { directory, id: 'application', controlId: `${child.pid}:${child.birth}` }, 'KILL');
		assert.equal(kill.mock.callCount(), 0);
		assert.deepEqual(await native.inspect(child.pid), retired, 'A visible zombie is not physical disappearance.');
		absent = true; assert.equal(await native.inspect(child.pid), null);
	});

	test(`Linux inspection confirms a live-to-${state} transition after executable ${code}`, linuxOnly, async context => {
		let missingExecutable = false, confirmations = 0;
		const { native } = await observer(context,
			() => missingExecutable && ++confirmations > 1 ? processStat(state, child.birth, 1) : processStat(),
			() => { if (missingExecutable) throw procError(code); return child.executable; });
		assert.deepEqual(await native.inspect(child.pid), { ...child, group: child.parent, session: child.parent, state: 'running' });
		missingExecutable = true;
		assert.deepEqual(await native.inspect(child.pid), { ...child, parent: 1, group: child.parent, session: child.parent, state: 'zombie' });
		assert.equal(confirmations, 2, 'The terminal identity must come from a fresh stat read.');
	});
}

for (const code of ['ENOENT', 'ESRCH']) {
	test(`Linux inspection confirms physical disappearance after executable ${code}`, linuxOnly, async context => {
		let missingExecutable = false, confirmations = 0;
		const { native } = await observer(context, () => {
			if (missingExecutable && ++confirmations > 1) throw procError(code);
			return processStat();
		}, () => { if (missingExecutable) throw procError(code); return child.executable; });
		await native.inspect(child.pid); missingExecutable = true;
		assert.equal(await native.inspect(child.pid), null); assert.equal(confirmations, 2);
	});

	test(`Linux inspection refuses a genuinely live birth with executable ${code}`, linuxOnly, async context => {
		let missingExecutable = false, confirmations = 0;
		const { native } = await observer(context, () => { if (missingExecutable) confirmations++; return processStat(); },
			() => { if (missingExecutable) throw procError(code); return child.executable; });
		await native.inspect(child.pid); missingExecutable = true;
		await assert.rejects(native.inspect(child.pid), /Live process executable is unavailable/u);
		assert.ok(confirmations >= 3 && confirmations <= 6, 'Live retirement confirmation has a small fixed read budget.');
	});
	for (const terminal of ['Z', 'X', 'gone']) {
		test(`Linux inspection waits through the admitted live transition before ${terminal} after ${code}`, linuxOnly, async context => {
			let missingExecutable = false, confirmations = 0;
			const { native } = await observer(context, () => {
				if (!missingExecutable) return processStat();
				if (++confirmations <= 3) return processStat(confirmations === 1 ? 'R' : 'S');
				if (terminal === 'gone') throw procError(code);
				return processStat(terminal, child.birth, 1);
			}, () => { if (missingExecutable) throw procError(code); return child.executable; });
			await native.inspect(child.pid); missingExecutable = true;
			const retired = await native.inspect(child.pid);
			assert.deepEqual(retired, terminal === 'gone' ? null : { ...child, parent: 1, group: child.parent, session: child.parent, state: 'zombie' });
			assert.equal(confirmations, 4, 'The observer must not return cached executable authority for the intermediate live state.');
		});
	}
}

test('Linux inspection never borrows executable authority for an unadmitted zombie', linuxOnly, async context => {
	const { native } = await observer(context, () => processStat('Z'), () => { throw procError('ENOENT'); });
	await assert.rejects(native.inspect(child.pid), /Live process executable is unavailable|Unadmitted/u);
});

test('Linux census does not admit a birth whose executable observation failed', linuxOnly, async context => {
	let terminal = false;
	const { native } = await observer(context, () => processStat(terminal ? 'Z' : 'S'), () => { throw procError('ENOENT'); });
	assert.deepEqual((await native.snapshot()).processes, []); terminal = true;
	await assert.rejects(native.inspect(child.pid), /Live process executable is unavailable|Unadmitted/u);
});

test('Linux inspection refuses a recycled birth at the missing-executable boundary', linuxOnly, async context => {
	let missingExecutable = false, confirmations = 0;
	const { native } = await observer(context,
		() => missingExecutable && ++confirmations > 1 ? processStat('Z', '999') : processStat(),
		() => { if (missingExecutable) throw procError('ENOENT'); return child.executable; });
	await native.inspect(child.pid); missingExecutable = true;
	await assert.rejects(native.inspect(child.pid), /birth|identity|executable is unavailable/u);
});

for (const code of ['EACCES', 'EPERM', 'EIO']) {
	test(`Linux inspection preserves executable ${code} failures for an admitted birth`, linuxOnly, async context => {
		let failed = false; const error = procError(code);
		const { native } = await observer(context, () => processStat(), () => { if (failed) throw error; return child.executable; });
		await native.inspect(child.pid); failed = true;
		await assert.rejects(native.inspect(child.pid), actual => actual === error);
	});
	test(`Linux inspection preserves confirming stat ${code} failures`, linuxOnly, async context => {
		let missingExecutable = false, confirmations = 0; const error = procError(code);
		const { native } = await observer(context, () => {
			if (missingExecutable && ++confirmations > 1) throw error;
			return processStat();
		}, () => { if (missingExecutable) throw procError('ENOENT'); return child.executable; });
		await native.inspect(child.pid); missingExecutable = true;
		await assert.rejects(native.inspect(child.pid), actual => actual === error);
	});
}

test('Linux inspection refuses malformed confirming stat data', linuxOnly, async context => {
	let missingExecutable = false, confirmations = 0;
	const { native } = await observer(context,
		() => missingExecutable && ++confirmations > 1 ? 'malformed' : processStat(),
		() => { if (missingExecutable) throw procError('ENOENT'); return child.executable; });
	await native.inspect(child.pid); missingExecutable = true;
	await assert.rejects(native.inspect(child.pid), /Invalid Linux process stat/u);
});

test('Linux inspection refuses a birth replaced after an intermediate live confirmation', linuxOnly, async context => {
	let missingExecutable = false, confirmations = 0;
	const { native } = await observer(context, () => {
		if (!missingExecutable || ++confirmations <= 2) return processStat();
		return processStat('Z', '999');
	}, () => { if (missingExecutable) throw procError('ENOENT'); return child.executable; });
	await native.inspect(child.pid); missingExecutable = true;
	await assert.rejects(native.inspect(child.pid), /birth|identity|executable is unavailable/u);
	assert.equal(confirmations, 3);
});

test('Linux census retires cached executable authority for physically absent PIDs', linuxOnly, async context => {
	let names = [String(child.pid)], terminal = false;
	const { native } = await observer(context, () => processStat(terminal ? 'Z' : 'S'),
		() => { if (terminal) throw procError('ENOENT'); return child.executable; }, () => names);
	await native.snapshot(); names = []; await native.snapshot(); terminal = true;
	await assert.rejects(native.inspect(child.pid), /Live process executable is unavailable|Unadmitted/u);
});

test('Linux census retires superseded births without losing the observed replacement', linuxOnly, async context => {
	let birth = child.birth, terminal = false;
	const { native } = await observer(context, () => processStat(terminal ? 'Z' : 'S', birth),
		() => { if (terminal) throw procError('ENOENT'); return birth === child.birth ? child.executable : '/owned/replacement'; });
	await native.snapshot(); birth = '999'; await native.snapshot(); terminal = true; birth = child.birth;
	await assert.rejects(native.inspect(child.pid), /Live process executable is unavailable|Unadmitted/u);
	birth = '999';
	assert.equal((await native.inspect(child.pid))?.executable, '/owned/replacement');
});

for (const visibility of ['zombie', 'unreadable-stat', 'unreadable-executable']) {
	test(`Linux census retains admitted births through a still-present ${visibility} row`, linuxOnly, async context => {
		let phase: 'admit' | 'census' | 'terminal' = 'admit';
		const { native } = await observer(context, () => {
			if (phase === 'census' && visibility === 'unreadable-stat') throw procError('EACCES');
			return processStat(phase === 'terminal' || phase === 'census' && visibility === 'zombie' ? 'Z' : 'S');
		}, () => {
			if (phase === 'terminal') throw procError('ENOENT');
			if (phase === 'census') throw procError('EACCES');
			return child.executable;
		});
		await native.snapshot(); phase = 'census'; assert.deepEqual((await native.snapshot()).processes, []); phase = 'terminal';
		assert.equal((await native.inspect(child.pid))?.executable, child.executable);
	});
}

for (const previouslyAdmitted of [false, true]) {
	test(`Linux stale census does not prune a birth ${previouslyAdmitted ? 'refreshed' : 'admitted'} after enumeration starts`, linuxOnly, async context => {
		let gated = false, terminal = false, release!: (names: readonly string[]) => void, began!: () => void;
		const names = new Promise<readonly string[]>(resolve => { release = resolve; });
		const started = new Promise<void>(resolve => { began = resolve; });
		const { native } = await observer(context, () => processStat(terminal ? 'Z' : 'S'),
			() => { if (terminal) throw procError('ENOENT'); return child.executable; },
			() => { if (!gated) return [String(child.pid)]; began(); return names; });
		if (previouslyAdmitted) await native.inspect(child.pid);
		gated = true; const census = native.snapshot(); await started;
		try { await native.inspect(child.pid); } finally { release([]); await census; }
		terminal = true; assert.equal((await native.inspect(child.pid))?.executable, child.executable);
	});
}
