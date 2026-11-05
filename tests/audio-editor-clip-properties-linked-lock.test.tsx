/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const audioPanel of [false, true]) for (const mode of ['linked-locked', 'unrelated-locked', 'linked-unlocked'] as const) {
	test(`${audioPanel ? 'audio panel' : 'video body'} admits only editable timing participants: ${mode}`, async () => {
		const source = createVideoSource({ id: 'picture-source', sampleRate: 48_000, frameCount: 96_000,
			width: 160, height: 90, frameRate: { num: 24, den: 1 } });
		const audioSource = createAudioSource({ id: 'audio-source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
		const video = createVideoClip({ id: 'picture', sourceId: source.id, title: 'Camera',
			durationFrames: 48_000, sourceDurationFrames: 48_000, avLinkId: mode === 'unrelated-locked' ? null : 'camera' });
		const audio = createAudioClip({ id: 'audio', sourceId: audioSource.id,
			durationFrames: 48_000, sourceDurationFrames: 48_000, avLinkId: mode === 'unrelated-locked' ? null : 'camera' });
		const admitted = createSoundscaperProject({ id: 'clip-properties-lock', sources: [source, audioSource], clips: [video, audio],
			tracks: [createVideoTrack({ id: 'picture-track', clipIds: [video.id], locked: audioPanel && mode !== 'linked-unlocked', ...(mode === 'unrelated-locked' ? {} : { laneGroupId: 'camera-lanes' }) }),
				createAudioTrack({ id: 'audio-track', clipIds: [audio.id], locked: !audioPanel && mode !== 'linked-unlocked', ...(mode === 'unrelated-locked' ? {} : { laneGroupId: 'camera-lanes' }) })] });
		const project = projectForRuntimeConsumers(admitted);
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = globals.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const root = createRoot(dom.container as unknown as Element);
		try {
			const props = { controller: { project, actions: { clip: {} } },
				snapshot: { project, selectedClipId: audioPanel ? audio.id : video.id }, copy: ENGLISH_COPY };
			await act(async () => root.render(audioPanel
				? <ClipPropertiesPanel {...props} run={operation => operation()} />
				: <ClipPropertiesBody {...props} />));
			const blocked = mode === 'linked-locked';
			if (audioPanel) {
				assert.equal(dom.one('[data-clip-properties-field="start"]').querySelector('input')?.hasAttribute('disabled'), blocked);
				assert.equal(dom.one('[data-clip-properties-field="length"]').querySelector('input')?.hasAttribute('disabled'), false);
				assert.equal(dom.one('[data-clip-properties-field="name"]').querySelector('input')?.hasAttribute('disabled'), false);
			} else {
				assert.equal(dom.one('[data-clip-field="startFrame"]').querySelector('[role="group"]')?.getAttribute('aria-disabled'), String(blocked));
				assert.equal(dom.one('[data-clip-field="durationFrame"]').querySelector('[role="group"]')?.getAttribute('aria-disabled'), String(blocked));
				assert.equal(dom.one('[data-clip-field="name"]').querySelector('input')?.hasAttribute('disabled'), false);
				assert.equal(dom.one('[data-clip-field="sourceInFrame"]').querySelector('[role="group"]')?.getAttribute('aria-disabled'), 'false');
			}
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = prior;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
