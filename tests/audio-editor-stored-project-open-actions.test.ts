/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectOpenRecoveryNotice } from '../src/common/editor/controller/document/project-open-recovery.ts';

import { createStoredProjectOpenActions } from
	'../src/common/editor/controller/document/stored-project-open-actions.ts';

test('openById forwards explicit active-session revision adoption to an open tab', async () => {
	const project = Object.freeze({ id: 'project-a' });
	const switches: Array<Readonly<{ project: typeof project; options: unknown }>> = [];
	const actions = createStoredProjectOpenActions({
		copy: { projectNotFound: 'Not found' },
		state: { recentProjectIds: [], projects: [] },
		store: { loadProject: async () => null },
		sessionTab: () => ({ history: { present: project } }),
		switchProject(value, options) {
			switches.push({ project: value, options });
		},
		openProject: () => undefined,
	});

	await actions.openById(project.id, { adoptSessionRevision: true });

	assert.deepEqual(switches, [{ project, options: { adoptSessionRevision: true } }]);
});

for (const entry of ['openById', 'openRecent'] as const) {
	for (const stage of ['load', 'activate'] as const) {
		test(`${entry} offers recovery after damaged project ${stage} without replacing the current workspace`, async () => {
			const damage = new Error('Invalid stored project');
			const state = { recentProjectIds: ['damaged'], projects: [{ id: 'damaged' }], projectRecovery: null as ProjectOpenRecoveryNotice | null };
			const inspected: string[] = [];
			let published = 0;
			const actions = createStoredProjectOpenActions({
				copy: { projectNotFound: 'Not found' }, state,
				store: { async loadProject() { if (stage === 'load') throw damage; return { id: 'damaged' }; } },
				sessionTab: () => null, switchProject: () => undefined,
				openProject: () => Promise.reject(damage),
				onProjectOpenFailure: async (id: string, error: unknown) => {
					assert.equal(error, damage); inspected.push(id); return true;
				},
				publishProjectState: () => { published += 1; },
			});
			await actions[entry]('damaged');
			assert.deepEqual(inspected, ['damaged']);
			assert.deepEqual(state.projectRecovery, { projectId: 'damaged', message: damage.message, requestId: 1 });
			assert.equal(published, 1);
		});
	}
}

test('stored open does not recover cancellation or inaccessible storage', async () => {
	for (const name of ['AbortError', 'EditorDisposedError', 'SecurityError', 'QuotaExceededError']) {
		const failure = Object.assign(new Error(name), { name });
		const actions = createStoredProjectOpenActions({
			copy: { projectNotFound: 'Not found' }, state: { recentProjectIds: [], projects: [] },
			store: { loadProject: () => Promise.reject(failure) }, sessionTab: () => null,
			switchProject: () => undefined, openProject: () => undefined,
			onProjectOpenFailure: async () => { assert.fail('Storage and cancellation are not document damage.'); },
		});
		await assert.rejects(actions.openById('damaged'), (error) => error === failure);
	}
});

test('a newer project intent suppresses late recovery inspection', async () => {
	let release = (): void => undefined;
	const inspection = new Promise<boolean>((resolve) => { release = () => resolve(true); });
	const state = { recentProjectIds: [], projects: [], projectRecovery: null as ProjectOpenRecoveryNotice | null };
	const actions = createStoredProjectOpenActions({
		copy: { projectNotFound: 'Not found' }, state,
		store: { async loadProject(id: string) { if (id === 'damaged') throw new Error('Damage'); return { id }; } },
		sessionTab: () => null, switchProject: () => undefined, openProject: () => undefined,
		onProjectOpenFailure: () => inspection,
	});
	const damaged = actions.openById('damaged');
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	await actions.openById('healthy');
	release();
	await damaged;
	assert.equal(state.projectRecovery, null);
});

test('activation queue changes made by the opener still offer recovery, including repeated direct opens', async () => {
	const state = { recentProjectIds: [], projects: [], projectQueue: Promise.resolve(), projectRecovery: null as ProjectOpenRecoveryNotice | null };
	const actions = createStoredProjectOpenActions({
		copy: { projectNotFound: 'Not found' }, state,
		store: { async loadProject() { return { id: 'damaged' }; } }, sessionTab: () => null,
		switchProject: () => undefined,
		async openProject() {
			await Promise.resolve();
			state.projectQueue = Promise.resolve();
			throw new Error('Activation found corrupt PCM');
		},
		getProjectId: () => 'previous', onProjectOpenFailure: async () => true,
	});
	await actions.openById('damaged');
	assert.equal(state.projectRecovery?.requestId, 1);
	await actions.open({ id: 'damaged' });
	assert.equal(state.projectRecovery?.requestId, 2);
});

test('missing media reported by activation enters the same recovery flow', async () => {
	const state = { recentProjectIds: [], projects: [], projectRecovery: null as ProjectOpenRecoveryNotice | null };
	const actions = createStoredProjectOpenActions({
		copy: { projectNotFound: 'Not found' }, state,
		store: { async loadProject() { return { id: 'missing-audio' }; } }, sessionTab: () => null,
		switchProject: () => undefined, openProject: () => undefined,
		hasMissingTimelineSources: () => true, onProjectOpenFailure: async () => true,
	});
	await actions.openById('missing-audio');
	assert.equal(state.projectRecovery?.projectId, 'missing-audio');
});
