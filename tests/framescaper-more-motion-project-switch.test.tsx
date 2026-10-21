/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperFinishingMenuItems } from '../src/common/editor/ui/framescaper-finishing-menu.ts';
import { createFramescaperFinishingCommand } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperMotionAnalysisActionsFinishing, bindFramescaperMotionAnalysisActionsFinishing,
	type FramescaperMotionAnalysisFrameProviderFinishing } from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MI22: motion analysis opened from Analyze cannot attach to a different project with the same source and stack', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let project = motionProject('original');
	const commands: unknown[] = [];
	const controller = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		commands.push(command); project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const store = createMemoryProjectStore(context, 'motion-project-switch');
	let started!: () => void, release!: () => void;
	const loading = new Promise<void>(resolve => { started = resolve; });
	const gate = new Promise<void>(resolve => { release = resolve; });
	const frameProvider: FramescaperMotionAnalysisFrameProviderFinishing = async request => {
		started(); await gate;
		return Array.from({ length: request.endFrame - request.startFrame }, (_, frameNumber) => ({
			frameNumber, frame: { width: 16, height: 16, samples: new Array<number>(16 * 16).fill(0.5) },
		}));
	};
	bindFramescaperMotionAnalysisActionsFinishing(controller,
		createFramescaperMotionAnalysisActionsFinishing({ owner: controller, store, frameProvider }));
	let opened = false;
	const menu = createFramescaperFinishingMenuItems({ productId: 'framescaper', project,
		capabilities: { videoMotionTracking: true }, editingBlocked: false }, { open: surface => { opened = surface === 'motion-tracking'; } });
	menu.analyze.find(item => item.id === 'framescaper-motion-tracking')?.onClick?.();
	assert.equal(opened, true);
	const render = () => root.render(<FramescaperFinishingDialog surface="motion-tracking" controller={controller}
		project={project} fileService={{ isDesktop: false }} editingBlocked={false} readOnly={false}
		run={operation => operation()} onClose={() => undefined} />);
	try {
		await act(async () => { render(); });
		await act(async () => { reactProps(dom.one('[data-framescaper-motion-analyze]')).onClick({}); await loading; });
		project = motionProject('duplicate');
		await act(async () => { render(); });
		await act(async () => { release(); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.deepEqual(commands, [], 'the old source read cannot publish analysis into the newly active document');
		assert.equal(project.id, 'duplicate');
		assert.deepEqual(project.videoMotionAnalyses, []);
	} finally {
		release();
		await act(async () => root.unmount());
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});

test('MI22: the native motion action also rejects project replacement when no dialog owns an abort signal', async context => {
	let project = motionProject('initial-action');
	const commands: unknown[] = [];
	const owner = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		commands.push(command); project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	let started!: () => void, release!: () => void;
	const loading = new Promise<void>(resolve => { started = resolve; });
	const gate = new Promise<void>(resolve => { release = resolve; });
	const runtime = createFramescaperMotionAnalysisActionsFinishing({ owner,
		store: createMemoryProjectStore(context, 'motion-action-project-switch'), frameProvider: async request => {
			started(); await gate;
			return Array.from({ length: request.endFrame - request.startFrame }, (_, frameNumber) => ({
				frameNumber, frame: { width: 16, height: 16, samples: new Array<number>(256).fill(0.5) },
			}));
		},
	});
	const running = runtime.analyze({ processorStackId: 'stack', startFrame: 0, endFrame: 3 });
	const rejected = assert.rejects(running, { name: 'AbortError' });
	await loading;
	project = motionProject('replacement-action');
	release();
	await rejected;
	assert.deepEqual(commands, []);
	assert.deepEqual(project.videoMotionAnalyses, []);
});

function motionProject(id: string) {
	const project = createFramescaperProject(PROFILE, { id, sources: [createVideoSource({ id: 'camera', storageKey: 'camera.mp4',
		contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 3,
		width: 16, height: 16, frameRate: { num: 3, den: 1 } })] });
	return applyFramescaperProjectCommand(PROFILE, project, createFramescaperFinishingCommand('motion-tracking', project,
		JSON.stringify({ videoMotionAnalyses: [], videoProcessorStacks: [{ schemaVersion: 1, id: 'stack', sourceId: 'camera', processors: [{
		schemaVersion: 1, id: 'tracker', kind: 'tracking', enabled: true, maximumFeatures: 16,
		quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 1,
	}] }] })));
}
