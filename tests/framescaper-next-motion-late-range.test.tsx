/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperFinishingCommand } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperFinishingMenuItems } from '../src/common/editor/ui/framescaper-finishing-menu.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { bindFramescaperMotionAnalysisActionsFinishing, createFramescaperMotionAnalysisActionsFinishing } from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the Motion Tracking menu can analyze a short window after the first4096source frames', async context => {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let project = createFramescaperProject(PROFILE, { id: 'long-motion', sources: [createVideoSource({
		id: 'camera', storageKey: 'camera.mp4', contentSha256: 'ab'.repeat(32),
		sampleFrameCount: 28_800_000, sourceFrameCount: 9_000, width: 16, height: 16, frameRate: { num: 15, den: 1 },
	})] });
	project = applyFramescaperProjectCommand(PROFILE, project, createFramescaperFinishingCommand('motion-tracking', project,
		JSON.stringify({ videoMotionAnalyses: [], videoProcessorStacks: [{ schemaVersion: 1, id: 'stack', sourceId: 'camera', processors: [{
			schemaVersion: 1, id: 'tracker', kind: 'tracking', enabled: true, maximumFeatures: 16,
			quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 1,
		}] }] })));
	const controller = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const decoded: number[][] = [];
	bindFramescaperMotionAnalysisActionsFinishing(controller, createFramescaperMotionAnalysisActionsFinishing({
		owner: controller, store: createMemoryProjectStore(context, 'next-motion-late-range'),
		frameProvider: request => { decoded.push([request.startFrame, request.endFrame]); throw new DOMException('Probe ended at the real decoder boundary.', 'AbortError'); },
	}));
	let opened = false;
	createFramescaperFinishingMenuItems({ productId: 'framescaper', project,
		capabilities: { videoMotionTracking: true }, editingBlocked: false }, {
		open: surface => { opened = surface === 'motion-tracking'; },
	}).analyze.find(item => item.id === 'framescaper-motion-tracking')?.onClick?.();
	assert.equal(opened, true);
	try {
		await act(async () => { root.render(<FramescaperFinishingDialog surface="motion-tracking" project={project}
			controller={controller} editingBlocked={false} readOnly={false} fileService={{}} run={operation => operation()} onClose={() => undefined} />); });
		const fields = () => dom.container.querySelectorAll('[data-timecode-direct-entry]');
		await act(async () => { reactProps(fields()[1]!).onChange({ currentTarget: { valueAsNumber: 6_002 } }); });
		assert.equal(Number(reactProps(fields()[1]!).value), 6_002, 'the run length ceiling must not truncate source positions');
		await act(async () => { reactProps(fields()[0]!).onChange({ currentTarget: { valueAsNumber: 6_000 } }); });
		await act(async () => { reactProps(dom.one('[data-framescaper-motion-analyze]')).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.deepEqual(decoded, [[6_000, 6_002]], 'the bounded late window reaches the production action frame provider');
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
