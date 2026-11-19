/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { bindFramescaperSelectedAuthoringController } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

for (const stage of ['queued', 'preparing'] as const) test(`Generate > Solid cannot write into a project activated while ${stage}`, async context => {
	let project = createFramescaperProject(PROFILE, { id: 'outgoing' });
	const incoming = createFramescaperProject(PROFILE, { id: 'incoming' });
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const replaceProject = (): void => { project = incoming; generation.activate(project.id); };
	let readProject = false;
	let commitStarted!: () => void;
	let releaseCommit!: () => void;
	const started = new Promise<void>(resolve => { commitStarted = resolve; });
	const committed = new Promise<void>(resolve => { releaseCommit = resolve; });
	const controller = {
		get project() {
			if (stage === 'preparing' && !readProject) {
				readProject = true;
				queueMicrotask(replaceProject);
			}
			return project;
		},
		getSnapshot: () => ({}), getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		captureProjectGeneration: generation.capture.bind(generation),
		assertProjectGeneration: generation.assertCurrent.bind(generation),
		actions: { edit: { async commit(command: unknown) {
			project = applyFramescaperProjectCommand(PROFILE, project, command);
			if (stage === 'queued' && project.id === 'outgoing') { commitStarted(); await committed; }
		} } },
	};
	bindFramescaperSelectedAuthoringController({ controller, store: createMemoryProjectStore(context, `generate-${stage}`) });
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(runtime);
	if (stage === 'queued') {
		const earlier = runtime.run('video-title');
		await started;
		const queued = runtime.run('video-solid');
		replaceProject();
		releaseCommit();
		await earlier;
		await assert.rejects(queued, { name: 'AbortError' });
	} else {
		await assert.rejects(runtime.run('video-solid'), { name: 'AbortError' });
	}
	assert.deepEqual(project, incoming);
});
