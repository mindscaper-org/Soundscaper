/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperFinishingCommand } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperMotionAnalysisActionsFinishing, bindFramescaperMotionAnalysisActionsFinishing } from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

const SRT = '1\n00:00:00,000 --> 00:00:01,000\nIncoming caption\n';

test('a pending outgoing caption file read cannot block or report into the next project', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let rejectOld: (error: Error) => void = () => undefined;
	const oldBody = new Promise<ArrayBuffer>((_resolve, reject) => { rejectOld = reject; });
	const outgoing = new File([SRT], 'outgoing.srt');
	Object.defineProperty(outgoing, 'arrayBuffer', { value: () => oldBody });
	let chosenFile = outgoing;
	let project = createFramescaperProject(PROFILE, { id: 'outgoing' });
	const commits: string[] = [];
	const controller = { actions: { edit: { commit(command: unknown) {
		commits.push(String(project.id));
		project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const render = () => root.render(<FramescaperFinishingDialog surface="captions" project={project} controller={controller}
		editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
		fileService={{ isDesktop: true, chooseFiles: () => [chosenFile], openReadDescriptor: value => value }} />);
	const choose = () => {
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(button); return button;
	};
	try {
		await act(async () => { render(); });
		await act(async () => { void reactProps(choose()).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(reactProps(choose()).disabled, true);
		project = createFramescaperProject(PROFILE, { id: 'incoming' });
		await act(async () => { render(); });
		assert.equal(reactProps(choose()).disabled, false, 'a new project owns an immediately usable caption editor');
		chosenFile = new File([SRT], 'incoming.srt');
		await act(async () => { void reactProps(choose()).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.deepEqual(commits, ['incoming']);
		await act(async () => { rejectOld(new Error('outgoing file read failed')); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(dom.container.textContent.includes('outgoing file read failed'), false);
		assert.equal(reactProps(choose()).disabled, false);
	} finally {
		rejectOld(new Error('retired'));
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

test('retired motion analysis cannot clear a replacement caption file operation', async context => {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let project = createFramescaperProject(PROFILE, { id: 'motion-owner', sources: [createVideoSource({
		id: 'camera', storageKey: 'camera.mp4', contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000,
		sourceFrameCount: 3, width: 16, height: 16, frameRate: { num: 3, den: 1 },
	})] });
	project = applyFramescaperProjectCommand(PROFILE, project, createFramescaperFinishingCommand('motion-tracking', project,
		JSON.stringify({ videoMotionAnalyses: [], videoProcessorStacks: [{ schemaVersion: 1, id: 'stack', sourceId: 'camera', processors: [{
			schemaVersion: 1, id: 'tracker', kind: 'tracking', enabled: true, maximumFeatures: 16,
			quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 1,
		}] }] })));
	const controller = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	let rejectMotion!: (error: Error) => void; let started!: () => void;
	const reading = new Promise<void>(resolve => { started = resolve; });
	const motionRead = new Promise<void>((_resolve, reject) => { rejectMotion = reject; });
	bindFramescaperMotionAnalysisActionsFinishing(controller, createFramescaperMotionAnalysisActionsFinishing({
		owner: controller, store: createMemoryProjectStore(context, 'next-finishing-owner'),
		frameProvider: async () => { started(); await motionRead; return []; },
	}));
	let resolveCaption!: (bytes: ArrayBuffer) => void;
	const captionRead = new Promise<ArrayBuffer>(resolve => { resolveCaption = resolve; });
	const caption = new File([SRT], 'incoming.srt'); Object.defineProperty(caption, 'arrayBuffer', { value: () => captionRead });
	const render = (surface: 'captions' | 'motion-tracking') => root.render(<FramescaperFinishingDialog surface={surface}
		project={project} controller={controller} editingBlocked={false} readOnly={false}
		run={operation => operation()} onClose={() => undefined}
		fileService={{ isDesktop: true, chooseFiles: () => [caption], openReadDescriptor: value => value }} />);
	const choose = () => { const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file'); assert.ok(button); return button; };
	try {
		await act(async () => { render('motion-tracking'); });
		await act(async () => { reactProps(dom.one('[data-framescaper-motion-analyze]')).onClick({}); await reading; });
		project = createFramescaperProject(PROFILE, { id: 'caption-owner' });
		await act(async () => { render('captions'); });
		await act(async () => { void reactProps(choose()).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(reactProps(choose()).disabled, true);
		await act(async () => { rejectMotion(new DOMException('Retired read.', 'AbortError')); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(reactProps(choose()).disabled, true, 'the new file still owns the pending state');
		assert.equal(dom.container.textContent.includes('Motion analysis cancelled.'), false);
		await act(async () => { resolveCaption(new TextEncoder().encode(SRT).buffer); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(reactProps(choose()).disabled, false);
	} finally {
		rejectMotion(new DOMException('Cleanup.', 'AbortError')); resolveCaption(new ArrayBuffer(0));
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
