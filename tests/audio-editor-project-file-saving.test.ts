/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectFileSaving } from '../src/common/editor/controller/document/internal/project-file-saving.ts';

type Project = { id: string; title: string; revision: number; tracks: unknown[]; clips?: unknown[] };
function fixture(desktop = true) {
	let current: Project = { id: 'a', title: 'A', revision: 1, tracks: [] };
	let settings = { autoSaving: !desktop, askBeforeClosing: true };
	const tabs = new Map([[current.id, current]]);
	const readOnlyIds = new Set<string>();
	const writes: unknown[] = [], discarded: string[] = [], decisions: string[] = [];
	const timers: Array<() => void> = [];
	const clearedTimers = new Set<number>();
	let flushes = 0;
	let fail = false, cancelSave = false;
	const service = createProjectFileSaving<Project>({
		desktop, getProject: () => current, getPreferences: () => settings,
		getProjects: () => [...tabs.values()].map(project => ({ project, readOnly: readOnlyIds.has(project.id) })),
		activate: async id => { current = tabs.get(id)!; }, flushInternal: async () => { flushes += 1; },
		write: async (_project, target) => { if (fail) throw new Error('disk full'); writes.push(target); return cancelSave ? { cancelled: true } : { fileHandle: target ?? { createWritable() {} } }; },
		prepareOriginal: async original => ({ id: original.id, name: original.name }),
		ask: async () => decisions.shift() as 'save' | 'discard' | 'cancel',
		discard: async id => { discarded.push(id); tabs.delete(id); }, handleError: () => undefined,
		schedule: callback => { timers.push(callback); return timers.length; }, clear: timer => { clearedTimers.add(timer); },
	});
	return { service, tabs, writes, discarded, decisions, timers, readOnlyIds,
		select: (id: string) => { current = tabs.get(id)!; service.observe(); },
		runPendingTimers: async () => {
			for (const [index, callback] of timers.entries()) {
				if (!clearedTimers.has(index + 1)) { clearedTimers.add(index + 1); callback(); }
			}
			await service.drain();
		},
		getFlushes: () => flushes,
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

test('closing an inactive read-only tab does not flush the active project', async () => {
	const f = fixture();
	f.tabs.set('b', { id: 'b', title: 'Read-only B', revision: 3, tracks: [], clips: [1] });
	f.readOnlyIds.add('b');

	assert.equal(await f.service.prepareClose('b'), true);
	assert.equal(f.getFlushes(), 0);
	assert.deepEqual(f.writes, []);
});
