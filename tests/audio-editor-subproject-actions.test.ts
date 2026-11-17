/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubprojectActions, type SubprojectDocument, type SubprojectRuntime } from '../src/common/editor/controller/document/subproject-actions.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { readSubprojectLinks } from '../src/common/editor/subprojects.ts';

function fixture() {
	let project: SubprojectDocument = createSoundscaperProject({ id: 'parent' }) as SubprojectDocument;
	const documents = new Map<string, SubprojectDocument>([['child', createSoundscaperProject({ id: 'child', title: 'Scene' }) as SubprojectDocument]]);
	let serial = 0, discarded = 0, renders = 0, blocked = false;
	let beforeRender: () => Promise<void> = () => Promise.resolve();
	const runtime: SubprojectRuntime = {
		getProject: () => project,
		assertWritable: () => { if (blocked) throw new Error('read-only'); },
		loadProject: id => Promise.resolve(documents.get(id) ?? null),
		listProjects: () => Promise.resolve([...documents.values(), project]),
		getLibraryId: () => Promise.resolve('library'),
		commit: command => { project = applySoundscaperProjectCommand(project, command) as SubprojectDocument; },
		createId: prefix => `${prefix}-${String(++serial)}`,
		openProject: id => Promise.resolve(id), prepare: () => Promise.resolve(),
		plan: () => ({ sampleRate: 48000, channelCount: 2, frameCount: 4 }),
		render: async (_node, geometry) => {
			renders++; await beforeRender(); const id = `audio-${String(++serial)}`;
			return { source: { id, kind: 'audio', name: 'Scene', storageKey: id, ...geometry }, discard: () => { discarded++; return Promise.resolve(); } };
		},
		reportError: error => { throw error; }, wait: () => Promise.resolve(),
	};
	return { actions: createSubprojectActions(runtime), documents, get project() { return project; },
		get discarded() { return discarded; }, get renders() { return renders; },
		beforeRender(callback: () => Promise<void>) { beforeRender = callback; },
		setProject(value: SubprojectDocument) { project = value; }, block() { blocked = true; } };
}

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
