/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import GeneratorClipPropertiesBody from '../src/common/editor/ui/inspector/GeneratorClipPropertiesBody.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

for (const [sourceFrames, sequenceFrames, hiddenFrames] of [[27, 23, 0], [9, 7, 0], [150, 125, 0], [27, 23, 1]] as const) {
	test(`generator EOF ${sourceFrames}/${sequenceFrames} retains ${hiddenFrames} hidden source frames in Properties`, async context => {
		const project = createFramescaperProject(PROFILE, { id: 'generator-eof',
			visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Tail',
				width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150 + hiddenFrames,
				generator: { kind: 'solid', color: '#ffffffff' } }] },
			clips: [{ schemaVersion: 1, kind: 'generator', id: 'tail', sourceId: 'source', sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: sequenceFrames, sourceInFrame: 150 - sourceFrames,
				sourceFrameCount: sourceFrames }], tracks: [{ id: 'pictures', type: 'video', clipIds: ['tail'] }],
			sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
			storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
				persisted: async () => true, persist: async () => true } as unknown as StorageManager,
		} });
		assert.ok(await environment.createProjectIfAbsent(project));
		const controller = await createFramescaperFixtureController(environment, project.id);
		context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
		controller.actions.clip.trim('tail', { durationFrames: sequenceFrames * 1920 });
		assert.equal(controller.project?.clips[0]?.sequenceFrameCount, sequenceFrames, 'a native trim at the existing EOF must be a no-op');
		const runtime = createEditorProjectRuntimeSelection(PROFILE), before = controller.project; assert.ok(before);
		const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		try {
			await act(async () => root.render(<GeneratorClipPropertiesBody controller={controller}
				project={runtime.projectForRuntimeConsumers(before)} clipId="tail" copy={ENGLISH_COPY} disabled={false} />));
			const field = dom.one('[data-clip-field="durationFrame"]');
			const input = field.querySelector('input'); assert.ok(input);
			assert.equal(input.value, String(sequenceFrames * 1920), 'the displayed EOF must retain every authored sequence frame');
			await act(async () => reactProps(input).onChange({ currentTarget: { valueAsNumber: sequenceFrames * 1920 } }));
			const wrapper = field.querySelector('[data-timecode-input]'); assert.ok(wrapper);
			await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
			assert.deepEqual(controller.project?.clips, before.clips, 'entering the exact existing EOF must not shorten the native clip');
		} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); }
	});
}

test('a generator can restore its complete left source window at a non-unity frame ratio', () => {
	const project = createFramescaperProject(PROFILE, { id: 'generator-head',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Head',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 18,
			generator: { kind: 'solid', color: '#ffffffff' } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'head', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 7, sequenceFrameCount: 7, sourceInFrame: 9, sourceFrameCount: 9 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['head'] }],
		sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const before = runtime.createHistory(project);
	const restored = runtime.executeCommand(before, { type: 'clip/trim', clipId: 'head', timelineStartFrame: 0 });
	assert.deepEqual(restored.present.clips[0], { ...project.clips[0], sequenceStartFrame: 0,
		sequenceFrameCount: 14, sourceInFrame: 0, sourceFrameCount: 18 });
	assert.deepEqual(runtime.undo(restored).present.clips, before.present.clips);
	assert.deepEqual(runtime.redo(runtime.undo(restored)).present.clips, restored.present.clips);
});
