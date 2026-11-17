/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionSnapshotActionFacade } from '../src/common/editor/controller/document/session-snapshot-action-facade.ts';
import { readSessionSnapshots, snapshotProjectState } from '../src/common/editor/session-snapshots.ts';
import { createSessionSnapshotMenuItems } from '../src/common/editor/ui/session-snapshot-menu.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

test('snapshot actions prepare live state before capture and wait for durable publication', async () => {
	let project = createSoundscaperProject(), saved = 0;
	const actions = createSessionSnapshotActionFacade({ getProject: () => project, createId: () => 'snapshot',
		commit: (command, selection, options) => {
			assert.deepEqual(selection, {}); assert.deepEqual(options, { skipPlaybackEngine: true });
			project = applySoundscaperProjectCommand(project, command);
		},
		prepare: () => { project = applySoundscaperProjectCommand(project, { type: 'project/recording-notes-set', notes: 'Prepared state' }); },
		save: () => { saved++; }, assertActive() {},
	});
	assert.equal(await actions.create('  Before edits  '), 'snapshot');
	assert.equal(saved, 1);
	assert.equal(actions.list()[0]!.name, 'Before edits');
	assert.equal((snapshotProjectState(project, readSessionSnapshots(project)[0]!).metadata as Record<string, unknown>).recordingNotes, 'Prepared state');
});

test('snapshot capture refuses an activation change even if the same project ID becomes active again', async () => {
	const project = createSoundscaperProject({ id: 'project' });
	let generation = 1, commits = 0;
	const actions = createSessionSnapshotActionFacade({ getProject: () => project, createId: () => 'snapshot',
		commit: () => { commits++; }, prepare: () => { generation++; }, save() {}, assertActive() {},
		captureGeneration: () => ({ projectId: project.id, generation }),
		assertGeneration: token => { if (token.generation !== generation) throw new DOMException('Project changed', 'AbortError'); },
	});
	await assert.rejects(actions.create('Before edits'), { name: 'AbortError' });
	assert.equal(commits, 0);
});

test('the real controller saves and restores snapshots through document history', async context => {
	const { controller, store } = await controllerSession(context);
	const actions = controller.actions.sessionSnapshots;
	const id = await actions.create('Original tempo');
	controller.actions.project.setTempo(90);
	actions.restore(id);
	assert.equal(controller.project?.tempo.bpm, 120);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tempo.bpm, 90);
	await controller.actions.project.save();
	const projectId = controller.project?.id; assert.ok(projectId);
	assert.equal(readSessionSnapshots(await store.loadProject(projectId)).length, 1);
	await controller.dispose();
	assert.throws(() => actions.restore(id), /dispos/iu);
});

test('the real controller refuses snapshot mutation for a read-only project', async context => {
	const { controller } = await controllerSession(context, { acquireProjectLock: async (projectId: string) => ({
		projectId, readOnly: true, method: 'test', retryAt: null, release() {},
	}) });
	assert.equal(controller.getSnapshot().readOnly, true);
	await assert.rejects(controller.actions.sessionSnapshots.create('Read-only'));
	assert.equal(readSessionSnapshots(controller.project).length, 0);
});

test('snapshots are offered through File only for Soundscaper and respect edit blocking', () => {
	let opened = 0;
	const [item] = createSessionSnapshotMenuItems('soundscaper', {}, false, () => { opened++; });
	assert.equal(item!.label, 'Session snapshots');
	assert.equal(item!.tooltipKey, 'session-snapshots');
	item!.onClick(); assert.equal(opened, 1);
	assert.equal(createSessionSnapshotMenuItems('soundscaper', {}, true, () => {})[0]!.disabled, true);
	assert.deepEqual(createSessionSnapshotMenuItems('framescaper', {}, false, () => {}), []);
});
