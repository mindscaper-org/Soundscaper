/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, project } from './helpers/audio-editor-project-switch-fixture.ts';
import { createProjectSwitchService } from '../src/common/editor/controller/document/project-switch-service.ts';
import { PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-identity.ts';

test('a failed origin save restores project ownership for later actions and same-project selection', async () => {
	const fixture = createFixture();
	const activeProject = fixture.getProject();
	assert.ok(activeProject);
	fixture.projectGeneration.activate(activeProject.id);
	const priorToken = fixture.projectGeneration.capture(activeProject.id);
	const saveFailure = new Error('Local storage is full.');
	fixture.setSaveNow(async () => { throw saveFailure; });

	await assert.rejects(fixture.service.switchProject(project('next-project')), (error) => error === saveFailure);
	assert.strictEqual(fixture.getProject(), activeProject);
	assert.equal(fixture.state.projectLock, fixture.initialLock);
	assert.throws(() => fixture.projectGeneration.assertCurrent(priorToken), { code: 'PROJECT_CHANGED' });
	const recoveredToken = fixture.projectGeneration.capture(activeProject.id);
	fixture.projectGeneration.assertCurrent(recoveredToken);

	await fixture.service.switchProject(activeProject);
	fixture.projectGeneration.assertCurrent(recoveredToken);
	assert.equal(fixture.events.includes('stop-engine'), false);
});

test('failing to acquire the target lock leaves the origin playable and writable', async () => {
	const fixture = createFixture();
	const origin = fixture.getProject();
	const target = project('target-lock-failure');
	const failure = new Error('The target project lock could not be acquired.');
	fixture.setAcquire(async () => { throw failure; });

	await assert.rejects(fixture.service.switchProject(target), error => error === failure);

	assert.strictEqual(fixture.getProject(), origin);
	assert.strictEqual(fixture.state.projectLock, fixture.initialLock);
	assert.equal(fixture.initialLock.releases, 0);
	assert.equal(fixture.events.includes('stop-engine'), false);
});

test('a failed target storage read releases the staged lock and preserves the active project', async () => {
	const fixture = createFixture();
	const origin = fixture.getProject();
	const target = project('target-read-failure');
	const failure = new Error('Temporary storage read failure');
	let released = 0;
	fixture.setAcquire(async id => ({ projectId: id, method: 'test', readOnly: false, release() { released += 1; } }));
	const service = createProjectSwitchService({
		...fixture.runtime,
		isActivatedProjectCurrent: () => Promise.reject(failure),
	});

	await assert.rejects(service.switchProject(target), error => error === failure);

	assert.strictEqual(fixture.getProject(), origin);
	assert.strictEqual(fixture.state.projectLock, fixture.initialLock);
	assert.equal(released, 1);
	assert.equal(fixture.events.includes('stop-engine'), false);
});

test('a second window taking write ownership during a target load opens the tab read-only', async () => {
	const fixture = createFixture();
	const target = project('target-taken-over');
	const targetLock = { projectId: target.id, method: 'test', readOnly: false, release() {} };
	fixture.setAcquire(async () => targetLock);
	const service = createProjectSwitchService({
		...fixture.runtime,
		async isActivatedProjectCurrent() {
			targetLock.readOnly = true;
			return true;
		},
	});

	await service.switchProject(target);

	assert.equal(fixture.getProject()?.id, target.id);
	assert.equal(fixture.getTab(target.id)?.readOnly, true);
	assert.equal(fixture.state.readOnly, true);
});

test('a writable project no longer shows the previous tab’s read-only error', async () => {
	const fixture = createFixture();
	fixture.setLoadReadOnly(true);
	await fixture.service.openProject({ ...project('readonly-tab'), schemaVersion: PROJECT_SCHEMA_VERSION + 1 });
	assert.deepEqual(fixture.statuses.at(-1), ['Future project', 'error']);
	await fixture.service.switchProject(project('writable-tab'));
	assert.deepEqual(fixture.statuses.at(-1), ['Ready', 'success']);
});

test('returning to a future-version tab still shows why it cannot be edited', async () => {
	const fixture = createFixture();
	const future = { ...project('future-tab'), schemaVersion: PROJECT_SCHEMA_VERSION + 1 };
	fixture.setLoadReadOnly(true);
	await fixture.service.openProject(future);
	await fixture.service.switchProject(project('writable-tab'));
	await fixture.service.switchProject(future);
	assert.equal(fixture.getTab(future.id)?.readOnly, true);
	assert.deepEqual(fixture.statuses.at(-1), ['Future project', 'error']);
});
