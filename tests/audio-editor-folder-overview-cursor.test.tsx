/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { FolderContentOverview } from '../src/common/editor/ui/timeline/FolderContentOverview.tsx';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { folderEditProject } from './helpers/folder-edit-project.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('clicking the collapsed folder overview places Split contents at the clicked cursor', async context => {
	const { project, source } = folderEditProject(), { controller, store } = await controllerSession(context);
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(source.frameCount).fill(.2)]); await writer.commit();
	await store.saveProject(project); await controller.actions.project.open(project);
	controller.actions.edit.execute('folder-select', { folderId: 'dialogue', propagateErrors: true });
	const current = controller.project; assert.ok(current);
	const projected = projectForRuntimeConsumers(current);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldReact = globals.React, oldAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const oldStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ getPropertyValue: () => '0' }) });
	context.after(async () => {
		await act(async () => root.unmount()); dom.restore(); globals.React = oldReact; globals.IS_REACT_ACT_ENVIRONMENT = oldAct;
		if (oldStyle) Object.defineProperty(globalThis, 'getComputedStyle', oldStyle); else Reflect.deleteProperty(globalThis, 'getComputedStyle');
	});
	await act(async () => root.render(<FolderContentOverview project={projected} folderId="dialogue" name="Dialogue"
		copy={ENGLISH_COPY} selection={projected.selection} controller={controller} pixelsPerSecond={100}
		sampleRate={48_000} renderOriginX={0} run={operation => operation()} />));
	const lane = dom.one('[data-folder-overview]');
	const target = { getBoundingClientRect: () => ({ left: 0 }), focus() {}, setPointerCapture() {}, releasePointerCapture() {} };
	const event = { currentTarget: target, clientX: CLIP_CONTENT_OFFSET + 50, pointerId: 1, button: 0, isPrimary: true,
		preventDefault() {}, stopPropagation() {} };
	await act(async () => { reactProps(lane).onPointerDown?.(event); });
	await act(async () => { reactProps(lane).onPointerUp?.(event); });
	assert.equal(controller.project?.selection.startFrame, 24_000);
	assert.equal(controller.project?.selection.endFrame, 24_000);
	controller.actions.edit.execute('folder-split', { folderId: 'dialogue', propagateErrors: true });
	const result = controller.project; assert.ok(result);
	for (const trackId of ['voice', 'ambience']) {
		const ids = result.tracks.find(track => track.id === trackId)?.clipIds;
		assert.ok(Array.isArray(ids));
		assert.equal(ids.length, 3);
		assert.ok(result.clips.some(clip => ids.includes(clip.id) && clip.timelineStartFrame === 24_000));
	}
	const outsideIds = result.tracks.find(track => track.id === 'music')?.clipIds;
	assert.ok(Array.isArray(outsideIds));
	assert.equal(outsideIds.length, 2);
});
