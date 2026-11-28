/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type ReactNode } from 'react';
import ClipSourceInTimeCodeField from '../src/common/editor/ui/inspector/ClipSourceInTimeCodeField.tsx';
import GeneratorClipPropertiesBody from '../src/common/editor/ui/inspector/GeneratorClipPropertiesBody.tsx';
import * as clipClock from '../src/common/editor/ui/inspector/clip-time-code-clock.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

test('the retired clip properties source frame rate helper is absent', () => {
	assert.equal(Object.hasOwn(clipClock, 'clipPropertiesSourceFrameRate'), false);
});

test('generator Properties video-frame format preserves native sixty-fps geometry', async () => {
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
	await withTimeCodeFields(async ({ render, enter }) => {
		assert.equal(clipClock.clipPropertiesFrameRate(visual, 'title'), 60);
		await render(<GeneratorClipPropertiesBody controller={controller} project={runtime.projectForRuntimeConsumers(visual)}
			clipId="title" copy={COPY} disabled={false} />);
		await enter('durationFrame', '00:00:02:01');
		assert.equal(visual.clips[0]?.sequenceFrameCount, 121);
	});
});

test('the source field uses native NTSC ordinals or the sequence display rate for audio', async () => {
	const sourceRate = { num: 30_000, den: 1_001 };
	const video = { id: 'video-ntsc', kind: 'video', frameRate: sourceRate, sourceFrameCount: 180,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: sourceRate } };
	const audio = createAudioSource({ id: 'audio-source', sampleRate: 44_100, frameCount: 176_400, channelCount: 1 });
	const changes: number[] = [];
	await withTimeCodeFields(async ({ render, enter }) => {
		for (const [key, source] of [['video', video], ['audio', audio],
			['invalid-audio-rate', { ...audio, frameRate: { num: 1, den: 0 } }]] as const) {
			await render(<ClipSourceInTimeCodeField key={key} label="Source in" value={0} source={source}
				sampleRate={44_100} frameRate={60} disabled={false} onCommit={value => { changes.push(value); }} />);
			await enter('sourceInFrame', '00:00:02:01');
		}
	});
	assert.deepEqual(changes, [61, 88_935, 88_935]);
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
	assert.equal(clipClock.clipPropertiesFrameRate(project, clip.id), 60);
});

async function withTimeCodeFields(testFields: (fixture: Readonly<{
	render(node: ReactNode): Promise<void>;
	enter(fieldName: string, timecode: string): Promise<void>;
}>) => Promise<void>) {
	const ui = mountControllerDataDom();
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const enter = async (fieldName: string, timecode: string) => {
		const field = ui.dom.one(`[data-clip-field="${fieldName}"]`);
		const button = field.querySelector('.timecode__format-button'); assert.ok(button);
		await act(async () => { reactProps(button).onClick?.(); });
		const video = ui.dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent.startsWith('Video frames')); assert.ok(video);
		await act(async () => { reactProps(video).onClick?.({ stopPropagation() {} }); });
		const frames = ui.dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent.startsWith('hh:mm:ss + frames')); assert.ok(frames);
		await act(async () => { reactProps(frames).onClick?.({ stopPropagation() {} }); });
		const display = field.querySelector('.timecode__display'); assert.ok(display);
		await act(async () => { reactProps(display).onDoubleClick?.({}); });
		const input = field.querySelector('.timecode__free-text'); assert.ok(input);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: timecode } }); });
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); });
	};
	try { await testFields({ render: ui.render, enter }); }
	finally {
		await ui.dispose();
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
}
