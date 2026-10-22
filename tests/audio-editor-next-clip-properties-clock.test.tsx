/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratorClipPropertiesBody from '../src/common/editor/ui/inspector/GeneratorClipPropertiesBody.tsx';
import { clipPropertiesTimeFields } from '../src/common/editor/ui/inspector/ClipPropertiesTimeFields.tsx';
import { clipPropertiesFrameRate, clipPropertiesSourceFrameRate } from '../src/common/editor/ui/inspector/clip-time-code-clock.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['audio', 'generator'] as const) test(`${kind} Properties video-frame format preserves native sixty-fps geometry`, async () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 144_000, channelCount: 1 });
	const clip = { ...createAudioClip({ id: 'clip', sourceId: source.id }), timelineStartFrame: 0,
		sourceStartFrame: 0, durationFrames: 144_000, sourceDurationFrames: 144_000 } satisfies Parameters<typeof clipPropertiesTimeFields>[0]['clip'];
	let audio = createSoundscaperProjectHistory(createSoundscaperProject({ id: 'audio-clock', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'audio', clipIds: [clip.id] })],
		sequences: [{ id: 'main', rate: { num: 60, den: 1 }, trackIds: ['audio'] }], primarySequenceId: 'main' }));
	let visual = createFramescaperProject(PROFILE, { id: 'generator-clock', visualModel: { generatorSources: [{ schemaVersion: 1,
		kind: 'generator', id: 'title-source', name: 'Title', width: 1920, height: 1080,
		frameRate: { num: 60, den: 1 }, frameCount: 300, generator: { kind: 'solid', color: '#ffffffff' } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'title-source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 300, sourceInFrame: 0, sourceFrameCount: 300 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['title'] }],
		sequences: [{ id: 'main', rate: { num: 60, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const controller = { actions: { clip: { trim(clipId: string, changes: Readonly<{ durationFrames: number }>) {
		visual = applyFramescaperProjectCommand(PROFILE, visual, { type: 'clip/trim', clipId, ...changes });
	} } } };
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const dom = installReactTestDom();
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		const options = { clip, source, sampleRate: 48_000, frameRate: 60, copy: COPY, disabled: false,
			onDuration(durationFrames: number) { audio = executeSoundscaperProjectCommand(audio, { type: 'clip/trim', clipId: clip.id, durationFrames }); } };
		assert.equal(clipPropertiesFrameRate(audio.present, clip.id), 60);
		assert.equal(clipPropertiesFrameRate(visual, 'title'), 60);
		assert.equal(clipPropertiesSourceFrameRate(source, 60), 60);
		assert.equal(clipPropertiesSourceFrameRate({ frameRate: { num: 30_000, den: 1_001 } }, 60), 30_000 / 1_001);
		await act(async () => root.render(kind === 'audio' ? <>{clipPropertiesTimeFields(options).length}</>
			: <GeneratorClipPropertiesBody controller={controller} project={runtime.projectForRuntimeConsumers(visual)}
				clipId="title" copy={COPY} disabled={false} />));
		const field = dom.one('[data-clip-field="durationFrame"]');
		const button = field.querySelector('.timecode__format-button'); assert.ok(button);
		await act(async () => { reactProps(button).onClick?.(); });
		const video = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent.startsWith('Video frames')); assert.ok(video);
		await act(async () => { reactProps(video).onClick?.({ stopPropagation() {} }); });
		const frames = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent.startsWith('hh:mm:ss + frames')); assert.ok(frames);
		await act(async () => { reactProps(frames).onClick?.({ stopPropagation() {} }); });
		const display = field.querySelector('.timecode__display'); assert.ok(display);
		await act(async () => { reactProps(display).onDoubleClick?.({}); });
		const input = field.querySelector('.timecode__free-text'); assert.ok(input);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: '00:00:02:01' } }); });
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); });
		if (kind === 'audio') assert.equal(audio.present.clips[0]?.durationFrames, 96_800);
		else assert.equal(visual.clips[0]?.sequenceFrameCount, 121);
	} finally {
		await act(async () => root.unmount()); dom.restore();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
});

test('audio frame-format ownership follows its foldered secondary sequence', () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 144_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 144_000 });
	const project = createSoundscaperProject({ id: 'folder-clock', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'audio', clipIds: [clip.id] })], trackFolders: [{ id: 'folder', name: 'Dialogue' }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'cut', rate: { num: 60, den: 1 }, trackNodes: [
				{ kind: 'folder', id: 'folder', parentFolderId: null }, { kind: 'track', id: 'audio', parentFolderId: 'folder' },
			] }], primarySequenceId: 'main' });
	assert.equal(clipPropertiesFrameRate(project, clip.id), 60);
	assert.equal(clipPropertiesSourceFrameRate({ frameRate: { num: 1, den: 0 } }, 60), 60);
});
