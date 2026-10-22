/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { nextFramescaperDesktopController } from './helpers/next-framescaper-desktop-controller.ts';

test('NP003: desktop File Duplicate allocates the copy identity supplied by the shipping dialog', async context => {
	const { controller, store, session } = await nextFramescaperDesktopController(context);
	const original = controller.project; assert.ok(original);
	const copied = await controller.actions.project.duplicate('A new library copy');
	assert.ok(copied);
	assert.notEqual(copied.id, original.id);
	assert.equal(controller.project?.id, copied.id);
	assert.equal(controller.project?.title, 'A new library copy');
	assert.ok(await session.readProjectBundle(copied.id));
	assert.deepEqual(await store.loadProject(original.id), original);
});

test('NP004: desktop File Open admits the saved revision of a noncolliding fscape project', async context => {
	const { controller, archive, store, session } = await nextFramescaperDesktopController(context);
	const project = createFramescaperProject(PROFILE, { id: 'external-saved-project', title: 'Saved revision', revision: 17 });
	const exported = await archive.exportScapeProject(project, store);
	const blob = exported.blob; assert.ok(blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([blob], 'Saved.fscape'), () => 'copy');
	assert.equal(controller.project?.id, project.id);
	assert.equal(controller.project?.revision, 17);
	assert.deepEqual(await store.loadProject(project.id), project);
	assert.ok(await session.readProjectBundle(project.id));
});
