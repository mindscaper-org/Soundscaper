/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectFileSaving } from '../src/common/editor/controller/document/internal/project-file-saving.ts';
import type { ProjectFileReference } from '../src/common/editor/file-save-stream.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

type Project = { id: string; title: string; revision: number; tracks: unknown[]; clips?: unknown[] };
function fixture(
	desktop = true,
	restore?: (id: string) => Promise<Readonly<{ originalFile: ProjectFileReference; baseline: string }> | null>,
	remember?: (id: string, target: Readonly<{ originalFile?: ProjectFileReference }>, baseline: string) => Promise<void> | void,
	acquireInactiveWrite?: (id: string) => Promise<Readonly<{ readOnly: boolean; release(): void }> | null>,
) {
	let current: Project = { id: 'a', title: 'A', revision: 1, tracks: [] };
	let settings = { autoSaving: !desktop, askBeforeClosing: true };
	const tabs = new Map([[current.id, current]]);
	const readOnlyIds = new Set<string>();
	const writes: unknown[] = [], discarded: string[] = [], decisions: string[] = [];
	const releasedOriginals: string[] = [];
	const timers: Array<() => void> = [];
	const clearedTimers = new Set<number>();
	let flushes = 0;
	let flush: () => Promise<void> = async () => undefined;
	let beforeCommit: () => Promise<void> = async () => undefined;
	let fail = false, cancelSave = false;
	const service = createProjectFileSaving<Project>({
		desktop, getProject: () => current, getPreferences: () => settings,
		getOpenProjectIds: () => [...tabs.keys()],
		getProjects: () => [...tabs.values()].map(project => ({ project, readOnly: readOnlyIds.has(project.id) })),
		activate: async id => { current = tabs.get(id)!; }, flushInternal: async () => { flushes += 1; await flush(); },
		write: async (_project, target, assertWritable?: () => void) => {
			await beforeCommit();
			assertWritable?.();
			if (fail) throw new Error('disk full');
			writes.push(target);
			return cancelSave ? { cancelled: true } : { fileHandle: target ?? { createWritable() {} } };
		},
		prepareOriginal: async original => ({ id: original.id, name: original.name }),
		ask: async () => decisions.shift() as 'save' | 'discard' | 'cancel',
		discard: async id => { discarded.push(id); tabs.delete(id); }, handleError: () => undefined,
		restore, remember, acquireInactiveWrite, release: original => { releasedOriginals.push(original.id); },
		schedule: callback => { timers.push(callback); return timers.length; }, clear: timer => { clearedTimers.add(timer); },
	});
	return { service, tabs, writes, discarded, decisions, timers, readOnlyIds, releasedOriginals,
		select: (id: string) => { current = tabs.get(id)!; service.observe(); },
		runPendingTimers: async () => {
			for (const [index, callback] of timers.entries()) {
				if (!clearedTimers.has(index + 1)) { clearedTimers.add(index + 1); callback(); }
			}
			await service.drain();
		},
		getFlushes: () => flushes,
		setFlush: (operation: () => Promise<void>) => { flush = operation; },
		setBeforeCommit: (operation: () => Promise<void>) => { beforeCommit = operation; },
		edit: () => { current = { ...current, revision: current.revision + 1, title: `${current.title}!` }; tabs.set(current.id, current); service.observe(); },
		setAuto: (value: boolean) => { settings = { ...settings, autoSaving: value }; service.observe(); },
		setAsk: (value: boolean) => { settings = { ...settings, askBeforeClosing: value }; },
		setFail: () => { fail = true; }, setCancelSave: () => { cancelSave = true; }, getProject: () => current,
	};
}

test('desktop Save writes the opened file while internal autosaves leave it alone', async () => {
	const f = fixture(); const fileHandle = { createWritable() {} };
	await f.service.opened(f.getProject(), { fileHandle }); f.edit();
	assert.equal(f.timers.length, 0); assert.equal(await f.service.hasChanges(f.getProject()), true);
	assert.equal(await f.service.save(), true); assert.deepEqual(f.writes, [fileHandle]);
	assert.equal(await f.service.hasChanges(f.getProject()), false);
});
test('automatic file saving is opt in on desktop and uses a retained destination', async () => {
	const f = fixture(); await f.service.opened(f.getProject(), { fileHandle: { createWritable() {} } });
	f.setAuto(true); f.edit(); f.timers.at(-1)!(); await f.service.drain();
	assert.equal(f.writes.length, 1); assert.equal(await f.service.hasChanges(f.getProject()), false);
});
test('automatic file saving without a destination leaves internal autosave retries to their owner', async () => {
	const f = fixture(false); f.service.observe(); f.edit();
	f.timers.at(-1)!(); await f.service.drain();
	assert.equal(f.getFlushes(), 0); assert.deepEqual(f.writes, []);
	await f.service.save();
	assert.equal(f.getFlushes(), 1); assert.equal(f.writes.length, 1);
});
test('new projects Save asks for a destination and a canceled picker keeps changes', async () => {
	const f = fixture(); f.service.observe(); f.edit(); f.setCancelSave();
	assert.equal(await f.service.save(), false); assert.equal(await f.service.hasChanges(f.getProject()), true);
});
test('cancel and failed Save keep the app open; disabling prompts still preserves internal recovery', async () => {
	const f = fixture(); await f.service.opened(f.getProject(), {}); f.edit();
	f.decisions.push('cancel'); assert.equal(await f.service.prepareClose(), false);
	f.setFail(); f.decisions.push('save'); await assert.rejects(f.service.prepareClose(), /disk full/u);
	f.setAsk(false); assert.equal(await f.service.prepareClose(), true); assert.deepEqual(f.discarded, []);
});
test('multi-project close defers discard until every project accepts closing', async () => {
	const f = fixture(); await f.service.opened(f.getProject(), {}); f.edit();
	f.tabs.set('b', { id: 'b', title: 'B', revision: 2, tracks: [1], clips: [1] });
	f.decisions.push('discard', 'cancel'); assert.equal(await f.service.prepareClose(), false); assert.deepEqual(f.discarded, []);
	f.decisions.push('discard', 'discard'); assert.equal(await f.service.prepareClose(), true); assert.deepEqual(f.discarded, ['a', 'b']);
});
test('revision-only changes do not trigger a save prompt', async () => {
	const f = fixture(); const project = f.getProject(); await f.service.opened(project, {});
	assert.equal(await f.service.hasChanges({ ...project, revision: 99 }), false);
});

test('closing with file autosaving enabled flushes the last edit even when close prompts are off', async () => {
	const f = fixture(); await f.service.opened(f.getProject(), { fileHandle: { createWritable() {} } });
	f.setAuto(true); f.setAsk(false); f.edit();
	assert.equal(await f.service.prepareClose(), true);
	assert.equal(f.writes.length, 1);
	assert.equal(await f.service.hasChanges(f.getProject()), false);
});

test('a failed automatic file save still offers the desktop close decision', async () => {
	const f = fixture();
	await f.service.opened(f.getProject(), { fileHandle: { createWritable() {} } });
	f.setAuto(true);
	f.edit();
	f.setFail();
	f.decisions.push('cancel', 'discard');

	assert.equal(await f.service.prepareClose(), false);
	assert.equal(await f.service.hasChanges(f.getProject()), true);
	assert.equal(await f.service.prepareClose(), true);
	assert.deepEqual(f.discarded, ['a']);
});

test('closing a different tab preserves a pending save for a background file', async () => {
	const f = fixture(false);
	const handle = { createWritable() {} };
	await f.service.opened(f.getProject(), { fileHandle: handle });
	f.edit();
	f.tabs.set('b', { id: 'b', title: 'B', revision: 0, tracks: [] });
	f.tabs.set('c', { id: 'c', title: 'C', revision: 0, tracks: [] });
	f.select('c');

	assert.equal(await f.service.prepareClose('b'), true);
	await f.runPendingTimers();

	assert.deepEqual(f.writes, [handle], 'the pending write for A still runs while C is active');
	assert.equal(await f.service.hasChanges(f.tabs.get('a')!), false);
});

test('a pending automatic save cannot overwrite the original of a tab another window is editing', async () => {
	const claims: string[] = [];
	const f = fixture(false, undefined, undefined, async id => { claims.push(id); return null; });
	await f.service.opened(f.getProject(), { fileHandle: { createWritable() {} } });
	f.edit();
	f.tabs.set('b', { id: 'b', title: 'Other project', revision: 0, tracks: [] });
	f.select('b');

	await f.runPendingTimers();

	assert.deepEqual(claims, ['a']);
	assert.deepEqual(f.writes, []);
	assert.equal(await f.service.hasChanges(f.tabs.get('a')!), true);
});

test('closing an inactive read-only tab does not flush the active project', async () => {
	const f = fixture();
	f.tabs.set('b', { id: 'b', title: 'Read-only B', revision: 3, tracks: [], clips: [1] });
	f.readOnlyIds.add('b');

	assert.equal(await f.service.prepareClose('b'), true);
	assert.equal(f.getFlushes(), 0);
	assert.deepEqual(f.writes, []);
});

test('closing a project while its desktop file association restores releases the late original', async () => {
	const pending = deferred<Readonly<{ originalFile: ProjectFileReference; baseline: string }>>();
	const requested = deferred<void>();
	const f = fixture(true, id => {
		if (id !== 'a') return Promise.resolve(null);
		requested.resolve();
		return pending.promise;
	});
	f.setAsk(false);
	f.service.observe();
	await requested.promise;
	f.tabs.set('b', { id: 'b', title: 'Another project', revision: 0, tracks: [] });
	assert.equal(await f.service.prepareClose('a'), true);
	f.tabs.delete('a');
	f.select('b');
	pending.resolve({ originalFile: { id: 'late-original', name: 'First.sscape' }, baseline: 'saved' });
	await settle();
	assert.deepEqual(f.releasedOriginals, ['late-original']);
});

test('closing a reopened track template without an original file still prompts to save', async () => {
	const f = fixture();
	f.tabs.set('b', { id: 'b', title: 'Dialogue and music template', revision: 3,
		tracks: [{ type: 'audio', name: 'Dialogue' }, { type: 'audio', name: 'Music' }] });
	f.select('b');
	f.decisions.push('cancel');
	assert.equal(await f.service.prepareClose('b'), false);
	assert.deepEqual(f.writes, []);
});

test('an older Save As cannot restore its destination after a newer Save As completes', async (context) => {
	const hashing = deferred<void>();
	const resume = deferred<void>();
	const digest = crypto.subtle.digest.bind(crypto.subtle);
	context.mock.method(crypto.subtle, 'digest', async (algorithm: AlgorithmIdentifier, bytes: Uint8Array<ArrayBuffer>) => {
		if (new TextDecoder().decode(bytes).includes('First archive write')) {
			hashing.resolve();
			await resume.promise;
		}
		return digest(algorithm, bytes);
	});
	const associations: string[] = [];
	const f = fixture(true, undefined, (_id, target) => { associations.push(target.originalFile!.id); });
	const first = f.service.saved({ ...f.getProject(), title: 'First archive write' }, {
		originalFile: { id: 'first', name: 'First.sscape' },
	});
	await hashing.promise;
	try {
		await f.service.saved(f.getProject(), { originalFile: { id: 'second', name: 'Second.sscape' } });
	} finally {
		resume.resolve();
		await first;
	}
	assert.deepEqual(associations, ['second']);
});

test('canceling a close does not undo an unrelated project switch during its flush', async () => {
	const f = fixture();
	let resume = () => {};
	const blockedFlush = new Promise<void>(resolve => { resume = resolve; });
	f.setFlush(() => blockedFlush);
	await f.service.opened(f.getProject(), {});
	f.edit();
	f.tabs.set('b', { id: 'b', title: 'B', revision: 0, tracks: [] });
	f.decisions.push('cancel');

	const closing = f.service.prepareClose('a');
	f.select('b');
	resume();
	assert.equal(await closing, false);
	assert.equal(f.getProject().id, 'b');
});

test('a pending Save cannot overwrite the original after another window takes over its tab', async () => {
	const f = fixture();
	const original = { createWritable() {} };
	await f.service.opened(f.getProject(), { fileHandle: original });
	f.edit();
	f.setBeforeCommit(async () => { await Promise.resolve(); f.readOnlyIds.add('a'); });

	await assert.rejects(f.service.save(), { name: 'AbortError' });
	assert.deepEqual(f.writes, []);
	assert.equal(await f.service.hasChanges(f.tabs.get('a')!), true);
});

test('a queued explicit Save does not flush a tab the user selected while it was waiting', async () => {
	const f = fixture();
	f.tabs.set('b', { id: 'b', title: 'B', revision: 0, tracks: [] });
	const target = { createWritable() {} };
	await f.service.opened(f.getProject(), { fileHandle: target });
	f.edit();
	let beginWrite = (): void => undefined;
	let releaseWrite = (): void => undefined;
	const writing = new Promise<void>(resolve => { beginWrite = resolve; });
	const release = new Promise<void>(resolve => { releaseWrite = resolve; });
	f.setBeforeCommit(() => { beginWrite(); return release; });
	const firstSave = f.service.save();
	await writing;
	const queuedSave = f.service.save();
	f.select('b');
	releaseWrite();

	assert.deepEqual(await Promise.all([firstSave, queuedSave]), [true, true]);
	assert.equal(f.getFlushes(), 1);
	assert.deepEqual(f.writes, [target, target]);
	assert.equal(f.getProject().id, 'b');
});
