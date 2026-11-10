/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import type { TimelineAudioBuffer, TimelineClipVisualData } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { projectClipsToViewport } from '../src/common/editor/design-system-adapters/timeline.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { Clip } from '../vendor/audacity-design-system/components/src/Clip/Clip.tsx';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
type Fixture = ReturnType<typeof mountControllerDataDom>;

function Properties({ controller, fixture }: Readonly<{ controller: Controller; fixture: Fixture }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const value: unknown = snapshot.project; assert.ok(validateSoundscaperProject(value));
	const project = { ...value, clips: value.clips.map(clip => {
		assert.ok(clip.kind === 'audio' && typeof clip.sourceId === 'string');
		return { ...clip, sourceId: clip.sourceId };
	}) };
	return <ClipPropertiesPanel controller={controller} snapshot={{ ...snapshot, project }} copy={ENGLISH_COPY} run={fixture.run} />;
}

function isActualAudioBuffer(value: unknown): value is TimelineAudioBuffer {
	if (!value || typeof value !== 'object' || !('numberOfChannels' in value) || typeof value.numberOfChannels !== 'number'
		|| !('getChannelData' in value) || typeof value.getChannelData !== 'function') return false;
	assert.ok(Number.isSafeInteger(value.numberOfChannels) && value.numberOfChannels > 0);
	for (let channel = 0; channel < value.numberOfChannels; channel += 1) assert.ok(value.getChannelData(channel) instanceof Float32Array);
	return true;
}

function liveClipVisual(controller: Controller, id: string): TimelineClipVisualData | null {
	const visual = controller.getClipVisualData(id); if (!visual) return visual;
	const { buffer, pcmWindow, peakWindow } = visual;
	assert.ok(buffer === null || isActualAudioBuffer(buffer), 'preserve the actual imported source buffer');
	assert.ok(pcmWindow === undefined && peakWindow === undefined, 'this fixture never requests partial viewport windows');
	return { ...visual, buffer, pcmWindow, peakWindow };
}

/** The original browser RIFF16 fixture, with independently retained input PCM, never decoded by a fake engine. */
function originalTone(name: string, frequency: number, frames: number, channels: number) {
	const bytes = Buffer.alloc(44 + frames * channels * 2), pcm = Array.from({ length: channels }, () => new Float32Array(frames));
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(48_000 * channels * 2, 28);
	bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) {
		const sample = Math.round(Math.sin(2 * Math.PI * frequency * frame / 48_000 + (channel ? Math.PI / 3 : 0)) * .35 * 32_767);
		bytes.writeInt16LE(sample, 44 + (frame * channels + channel) * 2); pcm[channel]![frame] = (sample || 0) / 32_768;
	}
	return { file: new File([bytes], name, { type: 'audio/wav' }), pcm };
}

test('real property edits retain tiny speed direction and commit merged pitch as one durable history entry', async context => {
	const engine = { ...createMemoryEngine(), async decodeAudioData() { throw new Error('Fixture WAVs require the shipping PCM decoder.'); } };
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const { controller, store } = await controllerSession(context, { engine: engine as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Authored property custody must not substitute a native audio renderer.'); } });
	const tones = [originalTone('browser-long-tone.wav', 220, 384_000, 1),
		originalTone('browser-tone-a.wav', 330, 38_400, 2), originalTone('browser-tone-b.wav', 660, 38_400, 2)];
	await controller.actions.project.importFiles(tones.map(tone => tone.file));
	const admitted = clipboardProject(controller.project); assert.equal(admitted.sources.length, 3); assert.equal(admitted.clips.length, 3);
	const findClip = (name: string) => {
		const project = clipboardProject(controller.project), source = project.sources.find(row => row.name === name); assert.ok(source?.kind === 'audio');
		const clip = project.clips.find(row => row.sourceId === source.id); assert.ok(clip?.kind === 'audio');
		return clip;
	};
	const long = findClip('browser-long-tone.wav');
	const fixture = mountControllerDataDom();
	const field = (name: string) => fixture.dom.one(`[data-clip-properties-field="${name}"]`);
	const input = (name: string) => { const node = field(name).querySelector('input'); assert.ok(node); return node; };
	const edit = async (name: string, value: string) => {
		await act(async () => { reactProps(field(name)).onFocusCapture({ target: input(name) }); });
		await act(async () => { reactProps(input(name)).onChange({ target: { value } }); });
		await act(async () => { reactProps(field(name)).onBlur({ target: input(name) }); await fixture.settle(); });
	};
	const badges = () => {
		const project = clipboardProject(controller.project), clip = findClip('browser-long-tone.wav');
		assert.ok(typeof clip.timelineStartFrame === 'number' && typeof clip.durationFrames === 'number' && typeof clip.sourceStartFrame === 'number');
		const projection = projectClipsToViewport([{ ...clip, timelineStartFrame: clip.timelineStartFrame, durationFrames: clip.durationFrames }],
			{ viewportStartFrame: 0, viewportDurationFrames: 384_000, sampleRate: 48_000 });
		const projected = projection.clips[0]; assert.ok(projected);
		const model = createTimelineClipViewModel({ controller: { getClipVisualData: id => liveClipVisual(controller, id) }, sourceLookup: new Map(project.sources.map(source => [source.id, source])),
			clip: { ...projected, sourceStartFrame: clip.sourceStartFrame }, geometry: { overscanStartFrame: projection.overscanStartFrame, pixelsPerSecond: 120, sampleRate: 48_000 },
			selection: { selectedClipIds: null }, copy: ENGLISH_COPY, rendering: { color: 'blue' } });
		const markup = renderToStaticMarkup(<ThemeProvider><Clip name={model.name} width={model.duration * 120} height={120}
			clipDuration={model.duration} clipPitchCents={model.pitchCents} clipStretchFactor={model.stretchFactor} clipSpeedRatio={model.speedRatio} /></ThemeProvider>);
		return [...markup.matchAll(/class="clip-header__badge-value">([^<]*)</gu)].map(match => match[1]);
	};
	try {
		await controller.actions.timeline.selectClip(long.id);
		await fixture.render(<Properties controller={controller} fixture={fixture} />);
		assert.deepEqual(badges(), []);
		await act(async () => { reactProps(field('stretch-tempo')).onClick(); await fixture.settle(); });
		assert.equal(findClip('browser-long-tone.wav').stretchToTempo, true); assert.deepEqual(badges(), []);
		for (const [ratio, text] of [[.9999999, '99.9%'], [1.0000001, '100.1%']] as const) {
			await edit('speed', String(ratio * 100));
			const actual = findClip('browser-long-tone.wav');
			assert.ok(typeof actual.speedRatio === 'number' && Math.abs(actual.speedRatio - ratio) < 1e-15,
				'percentage entry retains the authored tiny ratio within floating-point conversion precision');
			assert.deepEqual([actual.durationFrames, actual.sourceStartFrame, actual.sourceDurationFrames], [384_000, 0, 384_000]);
			assert.deepEqual(badges(), [text]);
		}
		await edit('speed', '100'); assert.equal(findClip('browser-long-tone.wav').speedRatio, 1); assert.deepEqual(badges(), []);
		assert.deepEqual(controller.project?.clips.filter(clip => clip.id !== long.id), admitted.clips.filter(clip => clip.id !== long.id));
		const first = findClip('browser-tone-a.wav'), second = findClip('browser-tone-b.wav');
		await act(async () => { controller.actions.timeline.selectClip(first.id); controller.actions.timeline.selectClip(second.id, { additive: true }); });
		assert.deepEqual(controller.project?.selection.clipIds, [first.id, second.id]);
		assert.equal(fixture.dom.one('[data-clip-properties-panel]').getAttribute('data-selection'), '2');
		const beforePitch = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
		await edit('pitch', '2');
		assert.equal(input('pitch').value, '2');
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		for (const original of [first, second]) {
			assert.equal(original.renderCacheRevision, 0);
			const changed: SoundscaperProject['clips'][number] | undefined = clipboardProject(controller.project).clips.find(clip => clip.id === original.id);
			assert.deepEqual(changed, { ...original, pitchCents: 200, renderCacheRevision: 1 });
		}
		assert.deepEqual(controller.project?.clips.find(clip => clip.id === long.id), beforePitch.clips.find(clip => clip.id === long.id));
		assert.deepEqual(controller.project?.selection.clipIds, [first.id, second.id]);
		const afterPitch = clipboardProject(controller.project);
		await act(async () => { controller.actions.edit.undo(); });
		assert.equal(input('pitch').value, '0'); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(beforePitch));
		assert.deepEqual(controller.project?.selection.clipIds, [first.id, second.id]);
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(afterPitch));
		assert.deepEqual(controller.project?.sources, admitted.sources);
		await act(async () => { await controller.actions.project.flush(); });
		await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
			const original = tones.find(tone => tone.file.name === name); assert.ok(original);
			assertPcmChannelsEqual(channels, original.pcm, `${name}: exact original RIFF16 source PCM`);
		});
	} finally { await fixture.dispose(); }
});
