/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectBootstrapService } from '../src/common/editor/controller/document/internal/project/project-bootstrap-service.ts';
import { createFixture } from './helpers/audio-editor-project-bootstrap-fixture.ts';

test('a damaged startup project opens a recovery workspace without overwriting or cleaning its data', async () => {
	const fixture = createFixture();
	const damage = new Error('Invalid stored project');
	fixture.setLastProject('damaged', null);
	fixture.setLoadProject(async () => { throw damage; });
	const state = { ...fixture.state, startupProjectRecovery: null as { projectId: string; message: string } | null };
	const service = createProjectBootstrapService({
		...fixture.runtime, state,
		onStartupProjectFailure: async (id: string, error: unknown) => {
			assert.equal(id, 'damaged');
			assert.equal(error, damage);
			return true;
		},
		newProject: async (options?: { skipFlush?: boolean }) => {
			assert.equal(options?.skipFlush, true);
			fixture.events.push('recovery-workspace');
		},
	});
	await service.bootstrap(fixture.lifetime.capture());
	assert.deepEqual(state.startupProjectRecovery, { projectId: 'damaged', message: damage.message });
	assert.ok(fixture.events.includes('recovery-workspace'));
	assert.ok(!fixture.events.includes('save-now'));
	assert.ok(!fixture.events.includes('cleanup-assets'));
	assert.ok(!fixture.statuses.some(([message]) => message === 'Ready'));
});

test('startup recovery does not swallow storage failures or cancellation', async () => {
	for (const cancel of [false, true]) {
		const fixture = createFixture();
		const failure = new Error('Storage unavailable');
		fixture.setLastProject('damaged', null);
		fixture.setLoadProject(async () => {
			if (cancel) fixture.lifetime.beginDisposal();
			throw failure;
		});
		let inspected = 0;
		const service = createProjectBootstrapService({
			...fixture.runtime,
			onStartupProjectFailure: async () => { inspected += 1; return false; },
		});
		await assert.rejects(service.bootstrap(fixture.lifetime.capture()));
		assert.equal(inspected, cancel ? 0 : 1);
		assert.ok(!fixture.events.includes('new-project'));
	}
});

test('a missing current row can offer retained history without inspecting twice', async () => {
	const fixture = createFixture();
	fixture.setLastProject('history-only', null);
	const state = { ...fixture.state, startupProjectRecovery: null as { projectId: string; message: string } | null };
	let inspected = 0;
	const service = createProjectBootstrapService({ ...fixture.runtime, state,
		onStartupProjectFailure: async () => { inspected += 1; return true; },
	});
	await service.bootstrap(fixture.lifetime.capture());
	assert.equal(inspected, 1);
	assert.equal(state.startupProjectRecovery?.projectId, 'history-only');
});
