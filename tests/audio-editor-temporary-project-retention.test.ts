/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneTemporaryProjects } from '../src/common/editor/controller/document/project-file-saving-composition.ts';

test('the temporary limit keeps the newest closed copies and protects all open projects', async () => {
	const deleted: unknown[] = [];
	const projects = Array.from({ length: 14 }, (_, index) => ({ id: `project-${index}`, updatedAt: index.toString().padStart(2, '0') }));
	const store = { listProjects: async () => projects, loadProject: async (id: string) => projects.find(project => project.id === id),
		deleteProjectIfCurrent: async (project: unknown) => { deleted.push(project); return true; } };
	const acquire = async () => ({ readOnly: false, release() {} });
	await pruneTemporaryProjects({ store, openIds: new Set(['project-0', 'project-1']), acquire });
	assert.deepEqual(deleted, projects.slice(2, 6).reverse());
	deleted.length = 0;
	await pruneTemporaryProjects({ store, openIds: new Set(), acquire, preferences: { limitProjects: false, maximumProjects: 10 } });
	assert.deepEqual(deleted, []);
	await pruneTemporaryProjects({ store, openIds: new Set(projects.map(project => project.id)), acquire, preferences: { limitProjects: true, maximumProjects: 1 } });
	assert.deepEqual(deleted, []);
});
