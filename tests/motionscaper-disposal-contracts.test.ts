/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMotionscaperLaunchAuthority } from '../desktop/motionscaper-launch-authority.ts';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createMotionscaperDeliveryAuthority } from '../desktop/motionscaper-delivery-authority.ts';

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(finish => { resolve = finish; });
	return { promise, resolve };
}
const turn = () => new Promise<void>(resolve => { setImmediate(resolve); });
const plan = { identity: { projectId: 'p', revisionDigest: 'a'.repeat(64), compositionId: 'c' }, width: 1, height: 1,
	frameRate: { num: 24, den: 1 }, firstFrame: 0, frameCount: 1 };

test('launch disposal joins an admitted open and its eventual real file revocation', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-dispose-launch-')), path = join(directory, 'input.mscape');
	await writeFile(path, 'original');
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => null, chooseSave: async () => null });
	const entered = deferred<void>(), finish = deferred<void>(); let token = '', closed = false;
	const launch = createMotionscaperLaunchAuthority({ open: async value => {
		const capability = await files.openTrustedPath(value); token = capability.token; entered.resolve(); await finish.promise; return capability;
	}, revoke: async value => { await files.revokeRead(value); closed = true; }, notify: () => undefined });
	launch.enqueue([path]); const opening = launch.take(); let stopping: Promise<void> | undefined;
	try {
		await entered.promise; stopping = launch.dispose(); let settled = false; void stopping.then(() => { settled = true; });
		await turn(); assert.equal(settled, false, 'disposal must await the admitted native open');
		finish.resolve(); assert.equal(await opening, null); await stopping; assert.equal(closed, true);
		await assert.rejects(files.read({ token, offset: 0, length: 1 }), /capability/u);
	} finally { finish.resolve(); await Promise.allSettled([opening, stopping]); await files.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('launch disposal retains a failed revoke for an explicit retry', async () => {
	let fail = true, revocations = 0;
	const launch = createMotionscaperLaunchAuthority({ open: async () => ({ token: 'retained', name: 'input.mscape', byteLength: 1 }),
		revoke: async () => { revocations++; if (fail) throw new Error('close blocked'); }, notify: () => undefined });
	launch.enqueue([join(tmpdir(), 'input.mscape')]); assert.ok(await launch.take());
	await assert.rejects(launch.dispose(), /close|cleanup/u);
	fail = false; await launch.dispose(); assert.equal(revocations, 2, 'failed native custody must remain addressable');
});

test('a supplied launch callback cannot dispose before its own admission is registered', async () => {
	const entered = deferred<void>(), finish = deferred<void>(); let stopping: Promise<void> | undefined, revoked = false;
	const launch = createMotionscaperLaunchAuthority({ open: async () => {
		stopping = launch.dispose(); entered.resolve(); await finish.promise; return { token: 'late', name: 'input.mscape', byteLength: 1 };
	}, revoke: async () => { revoked = true; }, notify: () => undefined });
	launch.enqueue([join(tmpdir(), 'input.mscape')]); const opening = launch.take();
	try {
		await entered.promise; assert.ok(stopping); let settled = false; void stopping.then(() => { settled = true; });
		await turn(); assert.equal(settled, false); finish.resolve(); await opening; await stopping; assert.equal(revoked, true);
	} finally { finish.resolve(); await Promise.allSettled([opening, stopping]); }
});

for (const kind of ['acknowledge', 'reset'] as const) test(`launch disposal joins an admitted ${kind} without revoking twice`, async () => {
	const entered = deferred<void>(), finish = deferred<void>(); let revocations = 0;
	const launch = createMotionscaperLaunchAuthority({ open: async () => ({ token: 'retained', name: 'input.mscape', byteLength: 1 }),
		revoke: async () => { revocations++; entered.resolve(); await finish.promise; }, notify: () => undefined });
	launch.enqueue([join(tmpdir(), 'input.mscape')]); assert.ok(await launch.take());
	const action = kind === 'acknowledge' ? launch.acknowledge({ token: 'retained' }) : launch.reset();
	let stopping: Promise<void> | undefined;
	try {
		await entered.promise; stopping = launch.dispose(); let settled = false; void stopping.then(() => { settled = true; });
		await turn(); assert.equal(settled, false); finish.resolve(); await action; await stopping; assert.equal(revocations, 1);
	} finally { finish.resolve(); await Promise.allSettled([action, stopping]); await launch.dispose(); }
});

test('failed late launch revocations cannot grow beyond sixteen retained capabilities', async () => {
	let fail = true, opened = 0;
	const launch = createMotionscaperLaunchAuthority({ open: async () => {
		await launch.reset(); return { token: `retained-${++opened}`, name: 'input.mscape', byteLength: 1 };
	}, revoke: async () => { if (fail) throw new Error('close blocked'); }, notify: () => undefined });
	launch.enqueue([join(tmpdir(), 'input.mscape')]);
	try {
		for (let index = 0; index < 16; index++) await assert.rejects(launch.take(), /close blocked/u);
		await assert.rejects(launch.take(), /capacity|capabilities/u); assert.equal(opened, 16);
		assert.throws(() => launch.enqueue([join(tmpdir(), 'another.mscape')]), /pending/u);
	} finally { fail = false; await launch.dispose(); }
});

test('launch reset keeps its queued-path reservation throughout asynchronous revocation', async () => {
	const finish = deferred<void>(), paths = Array.from({ length: 16 }, (_, index) => join(tmpdir(), `input-${index}.mscape`));
	const launch = createMotionscaperLaunchAuthority({ open: async () => ({ token: 'active', name: 'input.mscape', byteLength: 1 }),
		revoke: () => finish.promise, notify: () => undefined });
	launch.enqueue(paths); assert.ok(await launch.take()); const resetting = launch.reset(); let accepted = 0;
	try {
		finish.resolve();
		for (let turn = 0; turn < 16; turn++) {
			await Promise.resolve();
			try { launch.enqueue([join(tmpdir(), 'overflow.mscape')]); accepted++; }
			catch (error) { assert.ok(error instanceof RangeError); }
		}
		await resetting; assert.equal(accepted, 0, 'reset must reserve the active path until it is requeued');
	} finally { finish.resolve(); await resetting; await launch.dispose(); }
});

for (const kind of ['Open', 'Save'] as const) test(`file disposal joins an admitted ${kind} chooser before returning`, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-dispose-file-')), path = join(directory, 'input.mscape');
	await writeFile(path, 'original'); const entered = deferred<void>(), finish = deferred<string | null>();
	const choose = () => { entered.resolve(); return finish.promise; };
	const files = createMotionscaperFileAuthority({ chooseOpen: choose, chooseSave: choose });
	const opening = kind === 'Open' ? files.selectOpen() : files.beginSave({ projectId: 'p', suggestedName: 'input.mscape', saveAs: true });
	const rejected = assert.rejects(opening, /closed/u); let stopping: Promise<void> | undefined;
	try {
		await entered.promise; stopping = files.dispose(); let settled = false; void stopping.then(() => { settled = true; });
		await turn(); assert.equal(settled, false); finish.resolve(path); await rejected; await stopping;
		assert.deepEqual(await readdir(directory), ['input.mscape']); assert.equal(await readFile(path, 'utf8'), 'original');
	} finally { finish.resolve(path); await Promise.allSettled([rejected, stopping]); await files.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('file disposal reports failed Save rollback and retains its transaction for retry', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-dispose-save-')), path = join(directory, 'input.mscape');
	await writeFile(path, 'original'); let fail = true, rollbacks = 0;
	const files = createMotionscaperFileAuthority({ chooseOpen: async () => path, chooseSave: async () => path }, { checkpoint: async phase => {
		if (phase === 'rollback-directory-sync') { rollbacks++; if (fail) throw new Error('rollback sync blocked'); }
	} });
	try {
		const save = await files.beginSave({ projectId: 'p', suggestedName: 'input.mscape', saveAs: true }); assert.ok(save);
		await files.write({ token: save.token, offset: 0, bytes: new TextEncoder().encode('candidate') });
		await files.commit({ token: save.token, byteLength: 9, phase: 'prepare' });
		await assert.rejects(files.dispose(), error => error instanceof AggregateError);
		assert.equal(await readFile(path, 'utf8'), 'original'); fail = false; await files.dispose();
		assert.equal(rollbacks, 2, 'a failed rollback must retain its publication authority');
		assert.equal(await readFile(path, 'utf8'), 'original');
	} finally { fail = false; await files.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('delivery disposal joins destination admission before returning and creates no late temporary files', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-dispose-delivery-')), path = join(directory, 'output.mov');
	const entered = deferred<void>(), finish = deferred<string | null>();
	const delivery = createMotionscaperDeliveryAuthority({ chooseOutput: () => { entered.resolve(); return finish.promise; },
		encoder: { encode: async () => { throw new Error('Encoding must not begin.'); } } });
	const opening = delivery.begin({ plan, suggestedName: 'output.mov' }), rejected = assert.rejects(opening, /closed/u);
	let stopping: Promise<void> | undefined;
	try {
		await entered.promise; stopping = delivery.dispose(); let settled = false; void stopping.then(() => { settled = true; });
		await turn(); assert.equal(settled, false); finish.resolve(path); await rejected; await stopping;
		assert.deepEqual(await readdir(directory), []);
	} finally { finish.resolve(path); await Promise.allSettled([rejected, stopping]); await delivery.dispose(); await rm(directory, { recursive: true, force: true }); }
});
