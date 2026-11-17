/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerFileSavingRuntime, pruneTemporaryProjects } from '../src/common/editor/controller/document/project-file-saving-composition.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

test('temporary cleanup removes older closed copies from the actual selected store', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const projects = ['old', 'recent', 'current'].map((id, index) => createSoundscaperProject({ id,
		now: `2026-11-17T12:0${index}:00Z` }));
	for (const project of projects) await store.saveProject(project);
	await pruneTemporaryProjects({ store, openIds: new Set(['current']),
		preferences: { limitProjects: true, maximumProjects: 2 },
		acquire: async () => ({ readOnly: false, release() {} }),
	});
	assert.equal(await store.loadProject('old'), null, 'the oldest closed working copy must be removed');
	assert.deepEqual((await store.listProjects()).map(project => project.id).sort(), ['current', 'recent']);
});

test('Discard closes and removes the selected stored working copy', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const project = createSoundscaperProject({ id: 'discarded', title: 'Discarded working copy' });
	await store.saveProject(project);
	let closed = false;
	const runtime = createControllerFileSavingRuntime({
		session: { getSnapshot: () => ({ tabs: closed ? [] : [{ projectId: project.id, history: { present: project } }] }) }, store,
		preferences: () => ({ saving: { autoSaving: false, askBeforeClosing: true },
			temporaryData: { limitProjects: true, maximumProjects: 10 } }),
		switchProject: async () => undefined, closeProject: async () => { closed = true; },
		acquire: async () => ({ readOnly: false, release() {} }), subscribe: () => () => undefined,
		signal: new AbortController().signal, handleError: error => { throw error; },
	});
	await runtime.discard(project.id);
	assert.equal(closed, true);
	assert.equal(await store.loadProject(project.id), null, 'Discard cannot leave the discarded working copy in the recovery library');
});

test('temporary cleanup cannot delete a newly saved project selected from an older inventory', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const old = createSoundscaperProject({ id: 'old', title: 'Older working copy', now: '2026-11-17T12:00:00Z' });
	const recent = createSoundscaperProject({ id: 'recent', now: '2026-11-17T12:01:00Z' });
	const current = createSoundscaperProject({ id: 'current', now: '2026-11-17T12:02:00Z' });
	for (const project of [old, recent, current]) await store.saveProject(project);
	const updated = applySoundscaperProjectCommand(old, { type: 'project/rename', title: 'Just saved in the other window' },
		{ now: '2026-11-17T12:03:00Z' });
	let concurrentSave = true, releases = 0;
	const acquire = async (id: string) => {
		// A different window can finish a save before releasing the lease cleanup was waiting for.
		if (id === old.id && concurrentSave) { concurrentSave = false; await store.saveProject(updated); }
		return { readOnly: false, release() { releases++; } };
	};
	const request = { store, openIds: new Set([current.id]), acquire,
		preferences: { limitProjects: true, maximumProjects: 2 } };
	await pruneTemporaryProjects(request);
	assert.deepEqual(await store.loadProject(old.id), updated, 'cleanup must preserve the newly saved generation');
	assert.ok(await store.loadProject(recent.id), 'the stale inventory cannot choose a replacement victim');
	await pruneTemporaryProjects(request);
	assert.deepEqual((await store.listProjects()).map(project => project.id).sort(), [current.id, old.id].sort(),
		'a fresh inventory reclaims the genuinely older closed copy');
	assert.equal(releases, 2);
});

test('temporary cleanup keeps a project reopened while its stored snapshot is loading', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const old = createSoundscaperProject({ id: 'old', now: '2026-11-17T12:00:00Z' });
	const current = createSoundscaperProject({ id: 'current', now: '2026-11-17T12:01:00Z' });
	await store.saveProject(old); await store.saveProject(current);
	let reopened = false;
	await pruneTemporaryProjects({ store: { listProjects: () => store.listProjects(),
		loadProject: async id => { const project = await store.loadProject(id); reopened = true; return project; },
		deleteProjectSnapshot: expected => store.deleteProjectSnapshot(expected),
	}, preferences: { limitProjects: true, maximumProjects: 1 }, openIds: new Set([current.id]),
	isOpen: id => id === old.id && reopened, acquire: async () => ({ readOnly: false, release() {} }) });
	assert.ok(await store.loadProject(old.id), 'the newly open tab must retain its working copy');
});

test('the desktop catalog summary identifies an eligible closed working copy', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const old = createSoundscaperProject({ id: 'old-desktop', now: '2026-11-17T12:00:00Z' });
	const current = createSoundscaperProject({ id: 'current-desktop', now: '2026-11-17T12:01:00Z' });
	await store.saveProject(old);
	await store.saveProject(current);
	await pruneTemporaryProjects({
		store: {
			listProjects: async () => (await store.listProjects()).map(({ id, title, revision, updatedAt }) => ({ id, title, revision, updatedAt })),
			loadProject: id => store.loadProject(id),
			deleteProjectSnapshot: expected => store.deleteProjectSnapshot(expected),
		},
		openIds: new Set([current.id]), preferences: { limitProjects: true, maximumProjects: 1 },
		acquire: async () => ({ readOnly: false, release() {} }),
	});
	assert.equal(await store.loadProject(old.id), null);
	assert.ok(await store.loadProject(current.id));
});

test('cleanup uses exact deletion when another window publishes after the final read', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const old = createSoundscaperProject({ id: 'old-racing', now: '2026-11-17T12:00:00Z' });
	const current = createSoundscaperProject({ id: 'current-racing', now: '2026-11-17T12:01:00Z' });
	const newer = applySoundscaperProjectCommand(old, { type: 'project/rename', title: 'Saved in another window' });
	await store.saveProject(old);
	await store.saveProject(current);
	await pruneTemporaryProjects({
		store: {
			listProjects: () => store.listProjects(), loadProject: id => store.loadProject(id),
			deleteProjectSnapshot: async expected => { await store.saveProject(newer); return store.deleteProjectSnapshot(expected); },
		},
		openIds: new Set([current.id]), preferences: { limitProjects: true, maximumProjects: 1 },
		acquire: async () => ({ readOnly: false, release() {} }),
	});
	assert.deepEqual(await store.loadProject(old.id), newer);
});

test('Discard preserves a newer revision saved before it acquired the closed tab lock', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const project = createSoundscaperProject({ id: 'discard-racing' });
	const updated = applySoundscaperProjectCommand(project, { type: 'project/rename', title: 'Taken over and saved' });
	await store.saveProject(project);
	let open = true;
	const runtime = createControllerFileSavingRuntime({
		session: { getSnapshot: () => ({ tabs: open ? [{ projectId: project.id, history: { present: project } }] : [] }) }, store,
		preferences: () => ({ saving: { autoSaving: false, askBeforeClosing: true }, temporaryData: { limitProjects: true, maximumProjects: 10 } }),
		switchProject: async () => undefined, closeProject: async () => { open = false; },
		acquire: async () => { await store.saveProject(updated); return { readOnly: false, release() {} }; },
		subscribe: () => () => undefined, signal: new AbortController().signal, handleError: error => { throw error; },
	});
	await assert.rejects(async () => runtime.discard(project.id), /changed/u);
	assert.deepEqual(await store.loadProject(project.id), updated);
});

test('Discard leaves the stored copy alone when the tab could not close', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const project = createSoundscaperProject({ id: 'discard-still-open' });
	await store.saveProject(project);
	const runtime = createControllerFileSavingRuntime({
		session: { getSnapshot: () => ({ tabs: [{ projectId: project.id, history: { present: project } }] }) }, store,
		preferences: () => ({ saving: { autoSaving: false, askBeforeClosing: true }, temporaryData: { limitProjects: true, maximumProjects: 10 } }),
		switchProject: async () => undefined, closeProject: async () => ({ closed: false }),
		acquire: async () => ({ readOnly: false, release() {} }), subscribe: () => () => undefined,
		signal: new AbortController().signal, handleError: error => { throw error; },
	});
	await assert.rejects(async () => runtime.discard(project.id), /open/u);
	assert.deepEqual(await store.loadProject(project.id), project);
});

test('Discard cannot delete changes already saved from another editor while the tab was inactive', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const ours = createSoundscaperProject({ id: 'discard-inactive' });
	const theirs = applySoundscaperProjectCommand(ours, { type: 'project/rename', title: 'Edited from the other window' });
	await store.saveProject(theirs);
	let open = true;
	const runtime = createControllerFileSavingRuntime({
		session: { getSnapshot: () => ({ tabs: open ? [{ projectId: ours.id, history: { present: ours } }] : [] }) }, store,
		getPersistedProject: () => ours,
		preferences: () => ({ saving: { autoSaving: false, askBeforeClosing: true }, temporaryData: { limitProjects: true, maximumProjects: 10 } }),
		switchProject: async () => undefined, closeProject: async () => { open = false; },
		acquire: async () => ({ readOnly: false, release() {} }), subscribe: () => () => undefined,
		signal: new AbortController().signal, handleError: error => { throw error; },
	});

	await assert.rejects(async () => runtime.discard(ours.id), /changed/u);
	assert.deepEqual(await store.loadProject(ours.id), theirs);
});
