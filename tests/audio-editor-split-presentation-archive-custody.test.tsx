/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { validateFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperPublishedProject } from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function authored(project: FramescaperProject) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = project;
	return document;
}

test('real visual Inspector opacity survives half-Title Split, history and fresh native Scape', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(authoring);
	await authoring.run('video-title');
	const initial = framescaperPublishedProject(controller.project);
	const original = normalizeVideoGeneratorClipV1(initial.clips.at(-1));
	const source = normalizeVideoGeneratorSourceV1(initial.sources.at(-1));
	assert.equal(initial.sampleRate, 48_000);
	assert.deepEqual(source.frameRate, { num: 30, den: 1 });
	assert.equal(source.generator.kind, 'title');
	assert.equal(source.frameCount, 150);
	assert.deepEqual([original.sequenceStartFrame, original.sequenceFrameCount], [0, 150]);
	controller.actions.timeline.selectClip(original.id);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const root = createRoot(dom.container as unknown as Element);
	let pending: Promise<unknown> | undefined;
	const render = async (project: FramescaperProject, id: string) => {
		await act(async () => { root.render(<FramescaperVisualInspectorDialog controller={controller} project={project}
			selectedClipId={id} editingBlocked={false} readOnly={false} onClose={() => undefined}
			run={operation => { pending = Promise.resolve().then(operation); return pending; }} />); });
	};
	const expectOpacity = () => assert.equal(dom.one('[data-visual-inspector-opacity]').value, '0.25');
	try {
		await render(initial, original.id);
		assert.equal(Reflect.get(reactProps(dom.one('[data-visual-inspector-blend]')), 'value'), 'normal');
		await act(async () => { reactProps(dom.one('[data-visual-inspector-opacity]')).onChange({ currentTarget: { value: '0.25' } }); });
		await act(async () => {
			reactProps(dom.one('[id="framescaper-visual-inspector-form"]')).onSubmit({ preventDefault() {} });
			await pending;
		});
		expectOpacity();
		const before = framescaperPublishedProject(controller.project);
		const styles = Array.isArray(before.videoVisualPresentations) ? before.videoVisualPresentations : [];
		assert.equal(styles.length, 1);
		const style = normalizeVideoVisualPresentationV1(styles[0]);
		assert.deepEqual([style.owner, style.opacity, style.blendMode], [{ kind: 'clip', id: original.id }, .25, 'normal']);
		const owner = before.tracks.find(track => Array.isArray(track.clipIds)
			&& track.clipIds.some((id: unknown) => typeof id === 'string' && id === original.id)); assert.ok(owner);
		const historyCount = controller.getSnapshot().history.undoEntries.length;
		controller.actions.edit.splitAt(120_000, [owner.id]);
		const after = framescaperPublishedProject(controller.project);
		const clips = after.clips.map(normalizeVideoGeneratorClipV1);
		assert.equal(clips.length, 2);
		const left = clips.find(clip => clip.id === original.id), right = clips.find(clip => clip.id !== original.id);
		assert.ok(left); assert.ok(right);
		assert.deepEqual(left, { ...original, sequenceFrameCount: 75, sourceFrameCount: 75 });
		assert.deepEqual(right, { ...original, id: right.id, sequenceStartFrame: 75, sequenceFrameCount: 75, sourceInFrame: 75, sourceFrameCount: 75 });
		assert.deepEqual(after.sources, before.sources);
		const copied = (Array.isArray(after.videoVisualPresentations) ? after.videoVisualPresentations : []).map(normalizeVideoVisualPresentationV1);
		assert.equal(copied.length, 2);
		for (const clip of clips) {
			const row = copied.find(candidate => candidate.owner.kind === 'clip' && candidate.owner.id === clip.id); assert.ok(row);
			assert.deepEqual(row, { ...style, id: row.id, owner: { kind: 'clip', id: clip.id } });
			if (clip.id === original.id) assert.equal(row.id, style.id); else assert.notEqual(row.id, style.id);
		}
		assert.equal(new Set(copied.map(row => row.id)).size, 2);
		assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
		await render(after, right.id); expectOpacity();
		controller.actions.edit.undo();
		const undone = framescaperPublishedProject(controller.project);
		assert.deepEqual(authored(undone), authored(before));
		await render(undone, original.id); expectOpacity();
		controller.actions.edit.redo();
		assert.deepEqual(authored(framescaperPublishedProject(controller.project)), authored(after));
		await render(framescaperPublishedProject(controller.project), right.id); expectOpacity();
		await controller.actions.project.flush();
		const current = framescaperPublishedProject(controller.project);
		assert.deepEqual(await environment.store.loadProject(current.id), current);
		const archive = createFramescaperScapeNativeRuntime(PROFILE);
		const exported = await archive.exportScapeProject(current, environment.store); assert.ok(exported.blob);
		const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
		try {
			const imported = await archive.importScapeProject(exported.blob, recipient);
			assert.equal(imported.readOnly, false);
			const reopened: unknown = imported.project; assert.ok(validateFramescaperProject(PROFILE, reopened));
			assert.deepEqual(reopened, current); assert.deepEqual(await recipient.loadProject(current.id), current);
			await render(reopened, right.id); expectOpacity();
		} finally { await recipient.close(); }
	} finally {
		await act(async () => { await pending; root.unmount(); });
		dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
});
