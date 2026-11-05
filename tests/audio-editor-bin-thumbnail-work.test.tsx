/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ProjectBinCard from '../src/common/editor/ui/workspace/ProjectBinCard.jsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as profile } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createProductVideoVisualPreviewRuntime, bindProductVideoVisualPreviewRuntime } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
for (const kind of ['generator', 'video'] as const) test(`${kind} bin thumbnails retain completed work across unrelated changes and cancel actual presentation replacements`, async () => {
	const project = createFramescaperProject(profile, { id: 'thumbnail-work', visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'solid', name: 'Solid', width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 10, generator: { kind: 'solid', color: '#ffffffff' } }] }, projectBin: { clips: [{ schemaVersion: 1, kind: 'generator', id: 'bin-solid', sourceId: 'solid', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 }] }, sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] }], primarySequenceId: 'main' });
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let requests = 0, aborts = 0;
	const runtime = createProductVideoVisualPreviewRuntime(async () => null, async ({ signal }) => { requests++; signal?.addEventListener('abort', () => aborts++); return null; }, undefined, { ownsSource: () => kind === 'video', createFrame: async () => null });
	const controller = { actions: { projectBin: { getVisualData: () => ({ available: true }), instanceCount: () => 0 } } };
	bindProductVideoVisualPreviewRuntime(controller, runtime);
	const clip = { ...project.projectBin.clips[0]!, kind };
	const source = project.sources.find(source => source.id === clip.sourceId)!;
	const noop = () => undefined;
	const view = (value: unknown, displayedSource = source) => <ProjectBinCard clip={clip} itemClips={[clip]} source={displayedSource} sources={[displayedSource]} project={value} controller={controller} copy={ENGLISH_COPY} locale="en" mutationBlocked={false} missing={false} selectedMediaTrack={null} preview={null} run={noop} onOpenMenu={noop} onDragEnd={noop} />;
	try {
		await act(async () => root.render(view(project)));
		assert.equal(requests, 1);
		await act(async () => root.render(view({ ...project, title: 'Renamed project' })));
		assert.equal(requests, 1);
		assert.equal(aborts, 0);
		const unrelated = { schemaVersion: 1, id: 'other', owner: { kind: 'clip', id: 'other-clip' }, enabled: true, opacity: 0.5, blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: [] };
		await act(async () => root.render(view({ ...project, videoVisualPresentations: [unrelated] })));
		assert.equal(requests, 1);
		const presented = { ...project, videoVisualPresentations: [{ ...unrelated, owner: { kind: 'clip', id: clip.id } }] };
		await act(async () => root.render(view(presented)));
		assert.equal(requests, 2);
		assert.equal(aborts, 1);
		await act(async () => root.render(view(presented, { ...source, name: 'Updated source' })));
		assert.equal(requests, 3, 'a source replacement invalidates the retained thumbnail');
		assert.equal(aborts, 2);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
