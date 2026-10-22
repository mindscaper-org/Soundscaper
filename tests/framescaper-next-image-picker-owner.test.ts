/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperSelectedImageAuthoringControllerTimelineImage as bind } from '../src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

test('Add Images keeps its project owner while file selection is pending', async () => {
	let project = createFramescaperProject(PROFILE, { id: 'outgoing' });
	let selected: (files: readonly File[]) => void = () => undefined;
	const files = new Promise<readonly File[]>(resolve => { selected = resolve; });
	let started: () => void = () => undefined;
	const choosing = new Promise<void>(resolve => { started = resolve; });
	const importedInto: string[] = [];
	const controller = { get project() { return project; }, getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		actions: { project: { flush: () => undefined, openById: () => undefined } } };
	bind({ controller, selectFiles: () => { started(); return files; },
		session: { captureProjectHistory: () => { throw new Error('No publication expected.'); },
			assertProjectHistoryToken: () => undefined, updateProjectHistory: () => undefined, markProjectSaved: () => undefined,
			getProjectHistory: () => { throw new Error('No publication expected.'); } },
		executeCommand: history => history, publishIfCurrent: async () => null,
		importImages: async request => { importedInto.push(request.project.id); return { project: request.project, files: [] }; },
	});
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(runtime);
	const pending = runtime.run('video-still'); await choosing;
	project = createFramescaperProject(PROFILE, { id: 'incoming' });
	selected([new File([Uint8Array.of(1)], 'outgoing.png', { type: 'image/png' })]);
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(importedInto, []);
});
