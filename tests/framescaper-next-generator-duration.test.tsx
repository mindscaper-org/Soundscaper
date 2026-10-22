/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import GeneratorClipPropertiesBody from '../src/common/editor/ui/inspector/GeneratorClipPropertiesBody.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('NP021: generated title duration cannot display or commit beyond its authored source end', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(authoring);
	await authoring.run('video-title');
	const original = controller.project; assert.ok(original); const clip = original.clips.at(-1); assert.ok(clip);
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async () => {
		assert.ok(controller.project);
		await act(async () => root.render(<GeneratorClipPropertiesBody controller={controller}
			project={runtime.projectForRuntimeConsumers(controller.project)} clipId={String(clip.id)} copy={ENGLISH_COPY} disabled={false} />));
	};
	const field = () => dom.one('[data-clip-field="durationFrame"]');
	const input = () => { const value = field().querySelector('input'); assert.ok(value); return value; };
	const enter = async (frames: number) => {
		await act(async () => reactProps(input()).onChange({ currentTarget: { valueAsNumber: frames } }));
		const wrapper = field().querySelector('[data-timecode-input]'); assert.ok(wrapper);
		await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
	};
	try {
		await render(); const entries = controller.getSnapshot().history.undoEntries.length;
		await enter(288_000);
		assert.equal(input().value, '240000', 'a six-second draft must reflect the five-second source bound');
		assert.equal(controller.project?.clips.at(-1)?.sequenceFrameCount, 150);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries, 'clamping to the current end must not add a no-op Undo step');
		await enter(192_000); await render();
		assert.equal(controller.project?.clips.at(-1)?.sequenceFrameCount, 120);
		assert.equal(input().value, '192000');
		controller.actions.edit.undo(); await render(); assert.equal(input().value, '240000');
		controller.actions.edit.redo(); await render(); assert.equal(input().value, '192000');
		await enter(240_000); await render(); assert.equal(input().value, '240000', 'an earlier trim remains extendable to its authored source end');
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); }
});
