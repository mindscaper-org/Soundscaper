/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const duration of [24_000, 192_000]) test(`frozen Properties commits ${duration} samples through native still timing`, async () => {
	const project = createFramescaperProject(PROFILE, { id: 'frozen-properties', primarySequenceId: 'main',
		visualModel: { stillSources: [{ schemaVersion: 1, kind: 'still', id: 'png', name: 'Camera Freeze', mimeType: 'image/png',
			storageKey: 'png', contentSha256: 'ab'.repeat(32), width: 16, height: 16, hasAlpha: false }] },
		clips: [{ schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'png', sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 90 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['frozen'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }] });
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	let history = runtime.createHistory(project);
	let audioCalls = 0;
	const controller = { actions: { clip: { trim: (clipId: string, changes: Readonly<{ durationFrames: number }>) => {
		history = runtime.executeCommand(history, { type: 'clip/trim', clipId, ...changes });
	} }, clipSourcePreview: { trim() { audioCalls += 1; } } } };
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		await act(async () => root.render(<ClipPropertiesPanel controller={controller} run={work => work()}
			runtimeProject={runtime.projectForRuntimeConsumers(project)}
			snapshot={{ project, selectedClipId: 'frozen', capabilities: { audioEffects: false, videoEffects: true } }} copy={ENGLISH_COPY} />));
		const field = dom.one('[data-clip-field="durationFrame"]');
		const input = field.querySelector('input'), wrapper = field.querySelector('[data-timecode-input]'); assert.ok(input && wrapper);
		await act(async () => reactProps(input).onChange({ currentTarget: { valueAsNumber: duration } }));
		await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
		assert.equal(audioCalls, 0, 'a constant PNG has no audio source trim');
		assert.equal(history.present.clips[0]?.sequenceFrameCount, duration / 1600);
		assert.deepEqual(history.present.sources, project.sources);
		assert.deepEqual(runtime.undo(history).present.clips, project.clips);
		assert.deepEqual(runtime.redo(runtime.undo(history)).present.clips, history.present.clips);
		assert.equal(dom.container.querySelector('[data-clip-field="sampleRate"]'), null);
		assert.equal(dom.container.querySelector('[data-clip-properties-drawer="fading"]'), null);
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
});
