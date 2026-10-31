/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createMotionSavedFileAuthority } from '../desktop/motion-saved-file-authority.ts';
import type { MotionSavePublicationCheckpoint } from '../desktop/motion-save-publication.ts';
import { readMotionSaveJournal, writeMotionSaveJournal } from '../desktop/motion-save-publication-journal.ts';

async function fixture(checkpoint?: (phase: MotionSavePublicationCheckpoint) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), 'motion-save-publication-')), path = join(directory, 'saved.mscape');
	await writeFile(path, 'previous complete archive');
	const dialogs = { chooseOpen: async () => path, chooseSave: async () => path };
	const files = createMotionscaperFileAuthority(dialogs, { checkpoint });
	const bound = await files.selectOpen(); assert.ok(bound); await files.bindOpened({ token: bound.token, projectId: 'motion' }); await files.release({ token: bound.token });
	const receiver = createMotionSavedFileAuthority({ chooseFile: async () => path });
	const watch = await receiver.select(); assert.ok(watch);
	const first = await receiver.poll({ watchId: watch.watchId, afterGeneration: 0 }); assert.equal(first.state, 'snapshot');
	if (first.state !== 'snapshot') throw new Error('Missing initial snapshot.');
	await receiver.release({ token: first.snapshot.token });
	const body = new TextEncoder().encode('next complete archive');
	const writer = await files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(writer);
	await files.write({ token: writer.token, offset: 0, bytes: body });
	return { directory, path, files, receiver, watch, writer, body, generation: first.snapshot.generation, dialogs,
		async close() { await files.dispose(); await receiver.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test('native Save keeps a complete candidate fenced until explicit publication, then renews watcher generation without changing its bytes', async () => {
	const f = await fixture();
	try {
		const prepared = await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		assert.equal(prepared.publication, 'prepared'); assert.equal(await readFile(f.path, 'utf8'), 'next complete archive');
		const pending = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: f.generation });
		assert.equal(pending.state, 'unavailable');
		assert.deepEqual(await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'status' }), prepared);
		const published = await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' });
		assert.equal(published.publication, 'published');
		const received = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: pending.generation });
		assert.equal(received.state, 'snapshot'); if (received.state !== 'snapshot') throw new Error('Published snapshot missing.');
		assert.ok(received.snapshot.generation > pending.generation);
		assert.equal(new TextDecoder().decode(await f.receiver.read({ token: received.snapshot.token, offset: 0, length: f.body.length })), 'next complete archive');
		await f.receiver.release({ token: received.snapshot.token });
		assert.deepEqual(await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' }), published);
		assert.deepEqual(await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'status' }), published);
		await f.files.cancel({ token: f.writer.token }); assert.equal(await readFile(f.path, 'utf8'), 'next complete archive');
		await f.files.cancel({ token: f.writer.token, acknowledge: true });
		assert.deepEqual(await readdir(f.directory), ['saved.mscape']);
	} finally { await f.close(); }
});

for (const failure of ['candidate-directory-sync', 'candidate-fingerprint'] as const) test(`native ${failure} failure cannot publish and abort restores the prior archive`, async () => {
	const f = await fixture(async phase => { if (phase === failure) throw new Error(failure); });
	try {
		await assert.rejects(f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' }), new RegExp(failure, 'u'));
		const pending = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: f.generation }); assert.equal(pending.state, 'unavailable');
		await f.files.cancel({ token: f.writer.token }); assert.equal(await readFile(f.path, 'utf8'), 'previous complete archive');
		assert.equal((await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'status' })).publication, 'rolled-back');
		await f.files.cancel({ token: f.writer.token, acknowledge: true });
		const restored = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: pending.generation });
		assert.equal(restored.state, 'snapshot'); if (restored.state === 'snapshot') await f.receiver.release({ token: restored.snapshot.token });
	} finally { await f.close(); }
});

test('pending native Save neither suppresses an independent atomic update nor overwrites it during cancellation', async () => {
	const f = await fixture();
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		await writeFile(join(f.directory, 'external.tmp'), f.body); await rename(join(f.directory, 'external.tmp'), f.path);
		const external = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: f.generation });
		assert.equal(external.state, 'snapshot'); if (external.state === 'snapshot') await f.receiver.release({ token: external.snapshot.token });
		await assert.rejects(f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' }), /changed|conflict/iu);
		await f.files.cancel({ token: f.writer.token }); await f.files.cancel({ token: f.writer.token, acknowledge: true });
		assert.equal(await readFile(f.path, 'utf8'), 'next complete archive');
	} finally { await f.close(); }
});

test('published cleanup failure retains authoritative status and cancellation only retries cleanup', async () => {
	let fail = true; const f = await fixture(async phase => { if (phase === 'published-cleanup' && fail) throw new Error('cleanup delayed'); });
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		const published = await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' });
		assert.equal(published.publication, 'published'); assert.match(published.cleanupError ?? '', /cleanup delayed/u);
		assert.equal((await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'status' })).publication, 'published');
		const received = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: f.generation });
		assert.equal(received.state, 'snapshot'); if (received.state === 'snapshot') await f.receiver.release({ token: received.snapshot.token });
		fail = false; await f.files.cancel({ token: f.writer.token, acknowledge: true }); assert.equal(await readFile(f.path, 'utf8'), 'next complete archive');
		assert.deepEqual(await readdir(f.directory), ['saved.mscape']);
	} finally { await f.close(); }
});

test('a fresh native authority opens a pending crashed Save only after rollback, without publishing its candidate', async () => {
	const f = await fixture(); let recovered: ReturnType<typeof createMotionscaperFileAuthority> | null = null;
	try {
		const prepared = await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		// A separate main process has no in-memory token or binding from the writer.
		recovered = createMotionscaperFileAuthority(f.dialogs);
		const selected = await recovered.selectOpen(); assert.ok(selected);
		assert.equal(selected.recoveredPublication?.publication, 'rolled-back');
		assert.equal(selected.recoveredPublication?.sha256, prepared.sha256);
		assert.equal(new TextDecoder().decode(await recovered.read({ token: selected.token, offset: 0, length: selected.byteLength })), 'previous complete archive');
		await recovered.release({ token: selected.token });
		assert.equal(await readFile(f.path, 'utf8'), 'previous complete archive');
		const retried = await recovered.selectOpen(); assert.ok(retried); assert.deepEqual(retried.recoveredPublication, selected.recoveredPublication);
		await recovered.release({ token: retried.token, acknowledgeRecovery: true });
		await recovered.release({ token: retried.token, acknowledgeRecovery: true });
		assert.deepEqual(await readdir(f.directory), ['saved.mscape']);
	} finally { await recovered?.dispose(); await f.close(); }
});

test('native commit phases remain closed IPC fields and do not grant paths or arbitrary phase calls', async () => {
	const { dispatchMotionscaperFileCall } = await import('../desktop/motionscaper-file-ipc.ts');
	const f = await fixture();
	try {
		for (const phase of ['prepare', 'publish', 'status'] as const) {
			const receipt = await dispatchMotionscaperFileCall(f.files, 'commit', { token: f.writer.token, byteLength: f.body.length, phase }) as { publication?: string };
			assert.equal(receipt.publication, phase === 'prepare' ? 'prepared' : 'published');
		}
		await assert.rejects(dispatchMotionscaperFileCall(f.files, 'commit', { token: f.writer.token, byteLength: f.body.length, phase: 'remove-fence' }), /phase/iu);
		await assert.rejects(dispatchMotionscaperFileCall(f.files, 'commit', { token: f.writer.token, byteLength: f.body.length, phase: 'status', path: f.path }), /fields/iu);
		await assert.rejects(dispatchMotionscaperFileCall(f.files, 'cancel', { token: f.writer.token, acknowledge: 'yes' }), /acknowledgement/iu);
	} finally { await f.close(); }
});

test('a failed rollback keeps its durable fence and retries the already restored backup before another Save', async () => {
	let fail = true; const f = await fixture(async phase => { if (phase === 'rollback-directory-sync' && fail) throw new Error('rollback sync delayed'); });
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		await assert.rejects(f.files.cancel({ token: f.writer.token }), /rollback sync delayed/u);
		await assert.rejects(f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'status' }), /incomplete/iu);
		await assert.rejects(f.files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }), /active|pending|rollback sync delayed/iu);
		fail = false; await f.files.cancel({ token: f.writer.token }); await f.files.cancel({ token: f.writer.token, acknowledge: true });
		assert.equal(await readFile(f.path, 'utf8'), 'previous complete archive');
		assert.deepEqual(await readdir(f.directory), ['saved.mscape']);
	} finally { await f.close(); }
});

test('restart recovery reports a published transaction and never restores its previous archive', async () => {
	const f = await fixture(); let recovered: ReturnType<typeof createMotionscaperFileAuthority> | null = null;
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		const published = await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' });
		recovered = createMotionscaperFileAuthority(f.dialogs); const selected = await recovered.selectOpen(); assert.ok(selected);
		assert.deepEqual(selected.recoveredPublication, { transactionId: published.transactionId, publication: 'published', byteLength: f.body.length, sha256: published.sha256 });
		assert.equal(new TextDecoder().decode(await recovered.read({ token: selected.token, offset: 0, length: selected.byteLength })), 'next complete archive');
		await recovered.release({ token: selected.token });
	} finally { await recovered?.dispose(); await f.close(); }
});

test('native backup leaves an in-flight old snapshot readable across prepare, rollback and publication while in-place mutations still refuse', async () => {
	const f = await fixture();
	try {
		const old = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: 0 }); assert.equal(old.state, 'snapshot');
		if (old.state !== 'snapshot') throw new Error('Missing retained old descriptor.');
		const readOld = async () => new TextDecoder().decode(await f.receiver.read({ token: old.snapshot.token, offset: 0, length: old.snapshot.byteLength }));
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		assert.equal(await readOld(), 'previous complete archive');
		await f.files.cancel({ token: f.writer.token }); assert.equal(await readOld(), 'previous complete archive');
		await f.files.cancel({ token: f.writer.token, acknowledge: true });
		const next = await f.files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(next);
		await f.files.write({ token: next.token, offset: 0, bytes: f.body });
		await f.files.commit({ token: next.token, byteLength: f.body.length, phase: 'prepare' });
		await f.files.commit({ token: next.token, byteLength: f.body.length, phase: 'publish' });
		assert.equal(await readOld(), 'previous complete archive'); await f.receiver.release({ token: old.snapshot.token });
		const current = await f.receiver.poll({ watchId: f.watch.watchId, afterGeneration: f.generation }); assert.equal(current.state, 'snapshot');
		if (current.state !== 'snapshot') throw new Error('Missing current descriptor.');
		await writeFile(f.path, 'mutated current archive');
		await assert.rejects(f.receiver.read({ token: current.snapshot.token, offset: 0, length: 1 }), /changed/iu);
		await f.receiver.release({ token: current.snapshot.token });
	} finally { await f.close(); }
});

test('native disposal drains an in-flight publication and preserves its committed recovery status', async () => {
	let arrive!: () => void, resume!: () => void;
	const entered = new Promise<void>(resolve => { arrive = resolve; }), barrier = new Promise<void>(resolve => { resume = resolve; });
	const f = await fixture(async phase => { if (phase === 'before-publication') { arrive(); await barrier; } });
	let recovered: ReturnType<typeof createMotionscaperFileAuthority> | null = null;
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		const publishing = f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' });
		await entered; const disposing = f.files.dispose(); resume();
		assert.equal((await publishing).publication, 'published'); await disposing;
		recovered = createMotionscaperFileAuthority(f.dialogs); const selected = await recovered.selectOpen(); assert.ok(selected);
		assert.equal(selected.recoveredPublication?.publication, 'published'); await recovered.release({ token: selected.token });
	} finally { resume(); await recovered?.dispose(); await f.close(); }
});

test('native read-release recovery acknowledgement is cleanup-only and rejects unknown, foreign and pending ownership', async () => {
	const f = await fixture(); const other = createMotionscaperFileAuthority(f.dialogs);
	const { dispatchMotionscaperFileCall } = await import('../desktop/motionscaper-file-ipc.ts');
	try {
		const ordinary = await other.selectOpen(); assert.ok(ordinary);
		await assert.rejects(other.release({ token: ordinary.token, acknowledgeRecovery: true }), /no recovered/iu);
		await other.release({ token: ordinary.token });
		await assert.rejects(other.release({ token: 'unknown', acknowledgeRecovery: true }), /capability/iu);
		await assert.rejects(dispatchMotionscaperFileCall(other, 'release', { token: 'unknown', acknowledgeRecovery: 'yes' }), /acknowledgement/iu);
		await assert.rejects(dispatchMotionscaperFileCall(other, 'release', { token: 'unknown', acknowledgeRecovery: true, transactionId: 'forged' }), /fields/iu);
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		const selected = await other.selectOpen(); assert.ok(selected?.recoveredPublication);
		const settled = await readMotionSaveJournal(f.path); assert.ok(settled); assert.equal(settled.journal.phase, 'rolled-back');
		await writeMotionSaveJournal(f.path, { ...settled.journal, transactionId: '00000000-0000-4000-8000-000000000000' }, settled.checksum);
		await assert.rejects(other.release({ token: selected.token, acknowledgeRecovery: true }), /another|pending/iu);
		const foreign = await readMotionSaveJournal(f.path); assert.ok(foreign); assert.notEqual(foreign.journal.transactionId, settled.journal.transactionId);
		await writeMotionSaveJournal(f.path, { ...settled.journal, phase: 'pending' }, foreign.checksum);
		await assert.rejects(other.release({ token: selected.token, acknowledgeRecovery: true }), /pending/iu);
		assert.equal((await readMotionSaveJournal(f.path))?.journal.phase, 'pending'); assert.equal(await readFile(f.path, 'utf8'), 'previous complete archive');
		const pending = await readMotionSaveJournal(f.path); assert.ok(pending);
		await writeMotionSaveJournal(f.path, settled.journal, pending.checksum);
		await other.release({ token: selected.token, acknowledgeRecovery: true });
		assert.equal(await readMotionSaveJournal(f.path), null); assert.equal(await readFile(f.path, 'utf8'), 'previous complete archive');
	} finally { await other.dispose(); await f.close(); }
});

for (const publication of ['rolled-back', 'published'] as const) test(`same-authority ${publication} recovery settles its original writer and permits the next normal Save after ACK`, async () => {
	const f = await fixture();
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		if (publication === 'published') await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' });
		const selected = await f.files.selectOpen(); assert.ok(selected); assert.equal(selected.recoveredPublication?.publication, publication);
		await f.files.release({ token: selected.token });
		const recovery = await f.files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: false }); assert.ok(recovery?.recoveredPublication);
		assert.equal(recovery.recoveredPublication.publication, publication);
		await assert.rejects(f.files.write({ token: recovery.token, offset: 0, bytes: f.body }), /recovery/iu);
		const retried = await f.files.selectOpen(); assert.ok(retried); await f.files.release({ token: retried.token, acknowledgeRecovery: true });
		assert.equal((await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'status' })).publication, publication);
		await f.files.cancel({ token: f.writer.token });
		const next = await f.files.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: false }); assert.ok(next);
		await f.files.cancel({ token: next.token });
		assert.equal(await readFile(f.path, 'utf8'), publication === 'published' ? 'next complete archive' : 'previous complete archive');
	} finally { await f.close(); }
});

for (const phase of ['candidate-directory-sync', 'before-publication'] as const) test(`native ${phase} refuses a replaced selected parent without mutating its replacement`, async () => {
	let directory = '', shifted = false;
	const f = await fixture(async current => {
		if (current !== phase || shifted) return;
		await rename(directory, `${directory}.parked`); await mkdir(directory); await writeFile(join(directory, 'saved.mscape'), 'independent directory archive'); shifted = true;
	});
	directory = f.directory;
	try {
		if (phase === 'candidate-directory-sync') await assert.rejects(f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' }), /directory/iu);
		else {
			await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
			await assert.rejects(f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' }), /directory/iu);
		}
		await assert.rejects(f.files.cancel({ token: f.writer.token }), /directory/iu);
		assert.equal(await readFile(f.path, 'utf8'), 'independent directory archive');
		await rename(directory, `${directory}.foreign`); await rename(`${directory}.parked`, directory); shifted = false;
		await f.files.cancel({ token: f.writer.token }); await f.files.cancel({ token: f.writer.token, acknowledge: true });
		assert.equal(await readFile(f.path, 'utf8'), 'previous complete archive');
		assert.equal(await readFile(join(`${directory}.foreign`, 'saved.mscape'), 'utf8'), 'independent directory archive');
	} finally {
		if (shifted) { await rm(directory, { recursive: true, force: true }); await rename(`${directory}.parked`, directory); }
		await f.close(); await rm(`${directory}.foreign`, { recursive: true, force: true });
	}
});

test('first-Save restart returns a recovery-only Save capability even when rollback removes the only destination file', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-first-save-recovery-')), path = join(directory, 'first.mscape');
	const dialogs = { chooseOpen: async () => path, chooseSave: async () => path };
	const original = createMotionscaperFileAuthority(dialogs), restarted = createMotionscaperFileAuthority(dialogs);
	const body = new TextEncoder().encode('first complete archive');
	try {
		const writer = await original.beginSave({ projectId: 'first', suggestedName: 'first.mscape', saveAs: false }); assert.ok(writer);
		await original.write({ token: writer.token, offset: 0, bytes: body });
		const prepared = await original.commit({ token: writer.token, byteLength: body.length, phase: 'prepare' });
		const recovery = await restarted.beginSave({ projectId: 'first', suggestedName: 'first.mscape', saveAs: false }); assert.ok(recovery?.recoveredPublication);
		assert.deepEqual(recovery.recoveredPublication, { transactionId: prepared.transactionId, publication: 'rolled-back', byteLength: body.length, sha256: prepared.sha256 });
		await assert.rejects(readFile(path), /ENOENT/u);
		assert.deepEqual(await readdir(directory), ['.first.mscape.motionscaper-save.json']);
		await assert.rejects(restarted.write({ token: recovery.token, offset: 0, bytes: body }), /recovery/iu);
		for (const phase of [undefined, 'prepare', 'publish'] as const) await assert.rejects(restarted.commit({ token: recovery.token, byteLength: body.length, ...(phase === undefined ? {} : { phase }) }), /recovery/iu);
		assert.equal((await restarted.commit({ token: recovery.token, byteLength: body.length, phase: 'status' })).publication, 'rolled-back');
		await restarted.cancel({ token: recovery.token }); await restarted.cancel({ token: recovery.token });
		assert.ok(await readMotionSaveJournal(path));
		await restarted.cancel({ token: recovery.token, acknowledge: true }); await restarted.cancel({ token: recovery.token, acknowledge: true });
		assert.equal(await readMotionSaveJournal(path), null);
		assert.equal((await restarted.commit({ token: recovery.token, byteLength: body.length, phase: 'status' })).publication, 'rolled-back');
		await assert.rejects(restarted.commit({ token: recovery.token, byteLength: body.length, phase: 'publish' }), /recovery/iu);
		const next = await restarted.beginSave({ projectId: 'first', suggestedName: 'first.mscape', saveAs: false }); assert.ok(next); assert.equal(next.recoveredPublication, undefined);
		await restarted.write({ token: next.token, offset: 0, bytes: body }); await restarted.commit({ token: next.token, byteLength: body.length });
		assert.deepEqual(new Uint8Array(await readFile(path)), body);
	} finally { await original.dispose(); await restarted.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('Save-dialog recovery validates journal project ownership before rollback and handles published output independently of its current destination bytes', async () => {
	const f = await fixture(); const restarted = createMotionscaperFileAuthority(f.dialogs);
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		await assert.rejects(restarted.beginSave({ projectId: 'foreign', suggestedName: 'saved.mscape', saveAs: true }), /project|ownership/iu);
		assert.equal((await readMotionSaveJournal(f.path))?.journal.phase, 'pending'); assert.equal(await readFile(f.path, 'utf8'), 'next complete archive');
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' });
		await rm(f.path);
		const recovery = await restarted.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(recovery?.recoveredPublication);
		assert.equal(recovery.recoveredPublication.publication, 'published'); await assert.rejects(readFile(f.path), /ENOENT/u);
		await restarted.cancel({ token: recovery.token, acknowledge: true }); assert.equal(await readMotionSaveJournal(f.path), null);
	} finally { await restarted.dispose(); await f.close(); }
});

test('published restart recovery remains readable while owned cleanup fails and retains correlation until a later ACK succeeds', async () => {
	let fail = true;
	const checkpoint = async (phase: MotionSavePublicationCheckpoint) => { if (phase === 'published-cleanup' && fail) throw new Error('published cleanup locked'); };
	const f = await fixture(checkpoint), restarted = createMotionscaperFileAuthority(f.dialogs, { checkpoint });
	try {
		await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'prepare' });
		const published = await f.files.commit({ token: f.writer.token, byteLength: f.body.length, phase: 'publish' }); assert.match(published.cleanupError ?? '', /cleanup locked/u);
		const selected = await restarted.selectOpen(); assert.ok(selected?.recoveredPublication); assert.equal(selected.recoveredPublication.publication, 'published');
		assert.equal(new TextDecoder().decode(await restarted.read({ token: selected.token, offset: 0, length: selected.byteLength })), 'next complete archive');
		await assert.rejects(restarted.release({ token: selected.token, acknowledgeRecovery: true }), /cleanup locked/u);
		assert.equal((await readMotionSaveJournal(f.path))?.journal.phase, 'published');
		const recovery = await restarted.beginSave({ projectId: 'motion', suggestedName: 'saved.mscape', saveAs: true }); assert.ok(recovery?.recoveredPublication);
		await assert.rejects(restarted.cancel({ token: recovery.token, acknowledge: true }), /cleanup locked/u);
		fail = false; await restarted.release({ token: selected.token, acknowledgeRecovery: true });
		await restarted.cancel({ token: recovery.token, acknowledge: true });
		assert.equal(await readMotionSaveJournal(f.path), null); assert.deepEqual(await readdir(f.directory), ['saved.mscape']);
		assert.equal(await readFile(f.path, 'utf8'), 'next complete archive');
	} finally { await restarted.dispose(); await f.close(); }
});
