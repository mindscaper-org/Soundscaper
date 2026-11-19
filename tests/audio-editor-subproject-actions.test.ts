/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubprojectActions, type SubprojectDocument, type SubprojectRuntime } from '../src/common/editor/controller/document/subproject-actions.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { readSubprojectLinks } from '../src/common/editor/subprojects.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION } from '../src/common/editor/clip-source-stretch-memory.ts';
import { createAudioWarpClipAuthority } from '../src/common/editor/audio-warp-clip-authority.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { SubprojectRenderUnavailableError } from '../src/common/editor/controller/document/internal/subprojects/subproject-renderer.ts';

function fixture(frameCount = 4) {
	let project: SubprojectDocument = createSoundscaperProject({ id: 'parent' }) as SubprojectDocument;
	const documents = new Map<string, SubprojectDocument>([['child', createSoundscaperProject({ id: 'child', title: 'Scene' }) as SubprojectDocument]]);
	const reads = new Map<string, number>();
	let serial = 0, discarded = 0, renders = 0, blocked = false;
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	let beforeRender: (id: string) => Promise<void> = () => Promise.resolve();
	const runtime: SubprojectRuntime = {
		getProject: () => project,
		assertWritable: () => { if (blocked) throw new Error('read-only'); },
		captureGeneration: () => generation.capture(),
		assertGeneration: token => generation.assertCurrent(token),
		loadProject: id => { reads.set(id, (reads.get(id) ?? 0) + 1); return Promise.resolve(documents.get(id) ?? null); },
		listProjects: () => Promise.resolve([...documents.values(), project]),
		getLibraryId: () => Promise.resolve('library'),
		commit: command => { project = applySoundscaperProjectCommand(project, command) as SubprojectDocument; },
		createId: prefix => `${prefix}-${String(++serial)}`,
		openProject: id => Promise.resolve(id), prepare: () => Promise.resolve(),
		plan: () => ({ sampleRate: 48000, channelCount: 2, frameCount }),
		render: async (node, geometry) => {
			renders++; await beforeRender(node.project.id); const id = `audio-${String(++serial)}`;
			return { source: { id, kind: 'audio', name: 'Scene', storageKey: id, ...geometry }, discard: () => { discarded++; return Promise.resolve(); } };
		},
		reportError: error => { throw error; }, wait: () => Promise.resolve(),
	};
	return { actions: createSubprojectActions(runtime), documents, reads, get project() { return project; },
		get discarded() { return discarded; }, get renders() { return renders; },
		beforeRender(callback: (id: string) => Promise<void>) { beforeRender = callback; },
		edit(command: AudioEditorCommand) { runtime.commit(command); },
		selectProject(value: SubprojectDocument) { project = value; generation.activate(value.id); },
		setProject(value: SubprojectDocument) { project = value; }, block() { blocked = true; } };
}

test('an unsupported saved child keeps its installed mix and lets another followed child refresh', async () => {
	const state = fixture();
	state.documents.set('sibling', createSoundscaperProject({ id: 'sibling', title: 'Other scene' }) as SubprojectDocument);
	await state.actions.add('child');
	await state.actions.add('sibling');
	const [first, second] = readSubprojectLinks(state.project);
	for (const id of ['child', 'sibling']) {
		state.documents.set(id, { ...state.documents.get(id)!, master: { gain: 0.25 }, revision: 2 });
	}
	const error = new SubprojectRenderUnavailableError('Render or commit the updated native plug-in first.');
	state.beforeRender(id => id === 'child' ? Promise.reject(error) : Promise.resolve());
	await state.actions.refresh();
	const refreshed = readSubprojectLinks(state.project);
	assert.equal(refreshed[0]!.sourceId, first!.sourceId);
	assert.notEqual(refreshed[1]!.sourceId, second!.sourceId);
	await assert.rejects(state.actions.refresh({ force: true, id: first!.id }), cause => cause === error);
});

test('switching back to a saved track playlist plays the refreshed subproject source', async () => {
	const state = fixture();
	await state.actions.add('child');
	const [original] = readSubprojectLinks(state.project);
	const trackId = (state.project.tracks as readonly { id: string }[])[0]!.id;
	state.edit({ type: 'track/playlist-create', trackId, id: 'alternate', name: 'Alternate',
		originalId: 'original', originalName: 'Original', mode: 'empty' });
	assert.equal(state.project.clips.length, 0);
	state.documents.set('child', { ...state.documents.get('child')!, master: { gain: 0.25 }, revision: 2 });
	await state.actions.refresh();
	const [refreshed] = readSubprojectLinks(state.project);
	assert.notEqual(refreshed!.sourceId, original!.sourceId);
	state.edit({ type: 'track/playlist-activate', trackId, id: 'original' });
	assert.equal(state.project.clips[0]?.sourceId, refreshed!.sourceId);
});

test('refreshing linked audio preserves a trimmed clip’s hidden stretch anchors', async () => {
	const state = fixture(400);
	await state.actions.add('child');
	const [clip] = state.project.clips;
	const clipId = String(clip!.id);
	const map = { feature: 'audio-warp', points: [
		{ source: { num: 0, den: 1 }, outer: { num: 0, den: 1 }, mode: 'forward' },
		{ source: { num: 100, den: 1 }, outer: { num: 200, den: 1 }, mode: 'forward' },
		{ source: { num: 400, den: 1 }, outer: { num: 400, den: 1 }, mode: 'forward' },
	] };
	state.edit({ type: 'audio-warp/set', clipId,
		expectedClipAuthority: { ...createAudioWarpClipAuthority(state.project as never, clipId) }, warpMap: map });
	state.edit({ type: 'clip/trim', clipId, sourceRange: true, sourceStartFrame: 220, sourceDurationFrames: 180, durationFrames: 120 });
	const before = state.project.clips[0]!.opaqueExtensions as Record<string, unknown>;
	const memory = before[CLIP_SOURCE_STRETCH_EXTENSION] as Record<string, unknown>;
	assert.ok(memory);
	state.documents.set('child', { ...state.documents.get('child')!, master: { gain: 0.25 }, revision: 2 });
	await state.actions.refresh();
	const refreshed = state.project.clips[0]!;
	const extensions = refreshed.opaqueExtensions as Record<string, unknown>;
	assert.notEqual(refreshed.sourceId, clip!.sourceId);
	assert.deepEqual(extensions[CLIP_SOURCE_STRETCH_EXTENSION], { ...memory, sourceId: refreshed.sourceId });
	state.edit({ type: 'clip/trim', clipId, sourceRange: true, sourceStartFrame: 0, sourceDurationFrames: 400, durationFrames: 400 });
	const reopened = state.project.clips[0]!.warpMap as typeof map;
	assert.ok(reopened.points.some(point => point.source.num === 100 && point.source.den === 1));
});

test('inserting creates ordinary playable audio and refresh follows only committed child changes', async () => {
	const state = fixture();
	await state.actions.add('child');
	assert.equal(state.project.clips.length, 1);
	assert.equal(state.project.clips[0]!.sourceId, readSubprojectLinks(state.project)[0]!.sourceId);
	const initial = state.project;
	await state.actions.refresh();
	assert.equal(state.renders, 1);
	state.documents.set('child', { ...state.documents.get('child')!, master: { gain: 0.25 }, revision: 2 });
	await state.actions.refresh();
	assert.equal(state.renders, 2);
	assert.notEqual(state.project.clips[0]!.sourceId, initial.clips[0]!.sourceId);
	assert.equal(readSubprojectLinks(state.project)[0]!.revision, 2);
	// Undoing an automatic refresh stays undone until a new child save or explicit refresh.
	state.setProject(initial);
	await state.actions.refresh();
	assert.equal(state.renders, 2);
	await state.actions.refresh({ force: true });
	assert.equal(state.renders, 3);
});

test('idle refresh reads each committed child only once and starts fresh on the next refresh', async () => {
	const state = fixture();
	for (let index = 0; index < 8; index++) await state.actions.add('child');
	assert.equal(state.reads.get('child'), 16);
	state.reads.clear();
	await state.actions.refresh();
	assert.equal(state.reads.get('child'), 1);
	assert.equal(state.renders, 8);
	state.documents.set('child', { ...state.documents.get('child')!, master: { gain: 0.5 }, revision: 2 });
	await state.actions.refresh();
	assert.equal(state.renders, 16);
	assert.ok(readSubprojectLinks(state.project).every(link => link.revision === 2));
});

test('each unchanged saved child is canonically hashed once per refresh', async () => {
	const state = fixture();
	for (let index = 0; index < 8; index++) await state.actions.add('child');
	let tracksInspections = 0;
	state.documents.set('child', new Proxy(state.documents.get('child')!, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'tracks') tracksInspections++;
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	}));
	await state.actions.refresh();
	assert.equal(tracksInspections, 2);
	await state.actions.refresh();
	assert.equal(tracksInspections, 4);
});

test('a child save during rendering discards obsolete output and leaves the parent intact', async () => {
	const state = fixture();
	const initial = state.project;
	state.beforeRender(() => {
		state.documents.set('child', { ...state.documents.get('child')!, master: { gain: 0.5 } });
		return Promise.resolve();
	});
	await assert.rejects(state.actions.add('child'), { name: 'AbortError' });
	assert.equal(state.project, initial);
	assert.equal(state.discarded, 1);
});

test('switching projects or losing write authority before completion cannot publish into either document', async () => {
	for (const loseAuthority of [false, true]) {
		const state = fixture();
		state.beforeRender(() => {
			if (loseAuthority) state.block(); else state.setProject(createSoundscaperProject({ id: 'different' }) as SubprojectDocument);
			return Promise.resolve();
		});
		await assert.rejects(state.actions.add('child'));
		assert.equal(state.project.clips.length, 0);
		assert.equal(state.discarded, 1);
	}
});

test('pinned audio and missing children remain playable, with explicit relinking to resume updates', async () => {
	const state = fixture();
	await state.actions.add('child');
	const link = readSubprojectLinks(state.project)[0]!;
	await state.actions.follow(link.id, false);
	state.documents.delete('child');
	await state.actions.refresh();
	assert.equal(state.renders, 1);
	await assert.rejects(state.actions.refresh({ force: true }), /missing/iu);
	assert.equal(state.project.clips.length, 1);
	state.documents.set('replacement', createSoundscaperProject({ id: 'replacement', title: 'Replacement' }) as SubprojectDocument);
	await state.actions.relink(link.id, 'replacement');
	assert.equal(readSubprojectLinks(state.project)[0]!.projectId, 'replacement');
	assert.equal(state.project.clips[0]!.durationFrames, 4);
});

test('automatic refresh keeps a missing child’s installed audio and still updates other children', async () => {
	const state = fixture();
	const second = createSoundscaperProject({ id: 'second', title: 'Second scene' }) as SubprojectDocument;
	state.documents.set(second.id, second);
	await state.actions.add('child');
	await state.actions.add(second.id);
	const [missing, other] = readSubprojectLinks(state.project);
	assert.ok(missing && other);
	state.documents.delete('child');
	state.documents.set(second.id, { ...second, master: { gain: 0.5 }, revision: 2 });

	await state.actions.refresh();

	const links = readSubprojectLinks(state.project);
	assert.equal(links.find(link => link.id === missing.id)?.sourceId, missing.sourceId);
	assert.equal(links.find(link => link.id === other.id)?.revision, 2);
	assert.equal(state.renders, 3);
	await assert.rejects(state.actions.refresh({ id: missing.id, force: true }), /missing/iu);
});

test('following a deleted child leaves the installed proxy pinned', async () => {
	const state = fixture();
	await state.actions.add('child');
	const link = readSubprojectLinks(state.project)[0]!;
	await state.actions.follow(link.id, false);
	state.documents.delete('child');

	await assert.rejects(state.actions.follow(link.id, true), /missing/iu);
	assert.equal(readSubprojectLinks(state.project)[0]!.followLatest, false);
});

test('manual Refresh can recreate an installed proxy even if the child revision is unchanged', async () => {
	const state = fixture();
	await state.actions.add('child');
	const original = readSubprojectLinks(state.project)[0]!;

	await state.actions.refresh({ id: original.id, force: true });

	assert.equal(state.renders, 2);
	assert.notEqual(readSubprojectLinks(state.project)[0]!.sourceId, original.sourceId);
	assert.equal(state.project.clips[0]!.sourceId, readSubprojectLinks(state.project)[0]!.sourceId);
});

test('manual Refresh reports a missing followed grandchild even when its installed proxy is available', async () => {
	const state = fixture();
	const grandchild = createSoundscaperProject({ id: 'grandchild', title: 'Nested scene' }) as SubprojectDocument;
	state.documents.set(grandchild.id, grandchild);
	const parent = state.project;
	state.selectProject(state.documents.get('child')!);
	await state.actions.add(grandchild.id);
	state.documents.set('child', state.project);
	state.selectProject(parent);
	await state.actions.add('child');
	const saved = state.project;
	state.documents.delete(grandchild.id);

	await assert.rejects(state.actions.refresh({ force: true }), /missing/iu);
	assert.equal(state.project, saved);
	await state.actions.refresh();
	assert.equal(state.project, saved);
});

test('refreshing the first linked subproject preserves the arrangement’s link order', async () => {
	const state = fixture();
	const second = createSoundscaperProject({ id: 'second', title: 'Second scene' }) as SubprojectDocument;
	state.documents.set(second.id, second);
	await state.actions.add('child');
	await state.actions.add(second.id);
	const before = readSubprojectLinks(state.project).map(link => link.id);
	state.documents.set('child', { ...state.documents.get('child')!, revision: 2, master: { gain: 0.25 } });

	await state.actions.refresh();

	assert.deepEqual(readSubprojectLinks(state.project).map(link => link.id), before);
});

for (const returnToOrigin of [false, true]) test(`queued inserts keep their original tab generation, return=${returnToOrigin}`, async () => {
	const state = fixture();
	const origin = state.project;
	let markStarted = (): void => undefined;
	let unblock = (): void => undefined;
	const started = new Promise<void>(resolve => { markStarted = resolve; });
	const release = new Promise<void>(resolve => { unblock = resolve; });
	state.beforeRender(async () => { markStarted(); await release; });
	const first = state.actions.add('child');
	await started;
	const queued = state.actions.add('child');
	const both = Promise.allSettled([first, queued]);
	state.selectProject(createSoundscaperProject({ id: 'different-parent' }) as SubprojectDocument);
	if (returnToOrigin) state.selectProject(origin);
	unblock();

	assert.deepEqual((await both).map(result => result.status), ['rejected', 'rejected']);
	assert.equal(state.renders, 1);
	assert.equal(state.discarded, 1);
	assert.deepEqual(readSubprojectLinks(state.project), []);
});
