/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import VideoCompositionDialog from '../src/common/editor/ui/inspector/VideoCompositionDialog.tsx';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const surface of ['composition', 'keyframes'] as const) test(`${surface} drafts belong to the opened project`, async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose(); await environment.close();
		globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); });
	await controller.ready;
	const project = (id: string) => createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...framescaperBaselineOptions(), id });
	await controller.actions.project.open(project('first'));
	controller.actions.timeline.selectClip('video-clip');
	const render = async () => await act(async () => {
		const props = { productId: 'framescaper', capability: true, controller, snapshot: controller.getSnapshot(), copy: ENGLISH_COPY,
			run: (operation: () => unknown) => operation(), onClose: () => undefined };
		root.render(surface === 'composition' ? <VideoCompositionDialog {...props} />
			: <VideoKeyframeDialog {...props} />);
	});
	await render();
	const hook = surface === 'composition' ? '[data-video-composition-field="opacity"]' : '[data-video-keyframe-field="end"]';
	const field = () => { const value = dom.find(hook); assert.ok(value); return value; };
	await act(async () => { reactProps(field()).onChange({ currentTarget: { value: '13' }, target: { value: '13' } }); });
	assert.equal(field().value, '13');
	await act(async () => {
		await controller.actions.project.open(project('second'));
		controller.actions.timeline.selectClip('video-clip');
	});
	await render();
	assert.equal(field().value, surface === 'composition' ? '100' : '10');
});
