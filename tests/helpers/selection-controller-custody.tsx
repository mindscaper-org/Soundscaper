/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { AccessibleSelectionToolbar } from '../../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { projectDurationFrames } from '../../src/common/editor/project.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { createMemoryEngine } from './audio-editor-controller-harness.js';
import { controllerSession } from './soundscaper-controller-session.ts';
import { mountControllerDataDom } from './controller-data-dom.ts';
import { reactProps } from './react-test-dom.ts';
import { assertAudioProjectArchivePcm } from './audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import type { TimelineAudioBuffer, TimelineClipVisualData } from '../../src/common/editor/ui/timeline/waveform-view-model.ts';

/** Exact browser RIFF16 source tuples, including its omitted-frequency silent recordings. */
export function selectionWav(name: string, frames: number, channels: number, sampleRate: number, frequency?: number) {
	const bytes = Buffer.alloc(44 + frames * channels * 2), pcm = Array.from({ length: channels }, () => new Float32Array(frames));
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
	bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32);
	bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) {
		const sample = frequency === undefined ? 0 : Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate + (channel ? Math.PI / 3 : 0)) * .35 * 32_767);
		bytes.writeInt16LE(sample, 44 + (frame * channels + channel) * 2); pcm[channel]![frame] = (sample || 0) / 32_768;
	}
	return { file: new File([bytes], name, { type: 'audio/wav' }), pcm, sampleRate };
}

type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
type Dom = ReturnType<typeof mountControllerDataDom>;

/** Admit the live source buffer; no decoded samples or visual fields are replaced. */
export function selectionClipVisual(controller: Controller, id: string): TimelineClipVisualData | null {
	const visual = controller.getClipVisualData(id); if (!visual) return visual;
	const { buffer, pcmWindow, peakWindow } = visual;
	const isBuffer = (value: unknown): value is TimelineAudioBuffer => {
		if (!value || typeof value !== 'object' || !('numberOfChannels' in value) || typeof value.numberOfChannels !== 'number'
			|| !('getChannelData' in value) || typeof value.getChannelData !== 'function') return false;
		assert.ok(Number.isSafeInteger(value.numberOfChannels) && value.numberOfChannels > 0);
		for (let channel = 0; channel < value.numberOfChannels; channel += 1) assert.ok(value.getChannelData(channel) instanceof Float32Array);
		return true;
	};
	assert.ok(buffer === null || isBuffer(buffer));
	assert.ok(pcmWindow === undefined && peakWindow === undefined, 'no partial viewport windows were requested');
	return { ...visual, buffer, pcmWindow, peakWindow };
}

function Toolbar({ controller, fixture }: Readonly<{ controller: Controller; fixture: Dom }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <AccessibleSelectionToolbar controller={controller} snapshot={snapshot} copy={ENGLISH_COPY}
		statusMessage="Ready" statusState="success" durationFrames={projectDurationFrames(snapshot.project)} disabled={false}
		showSelectionToolbar showStatusbar run={fixture.run} />;
}

export async function selectionControllerCustody(context: TestContext, input: ReturnType<typeof selectionWav>) {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), async decodeAudioData() { throw new Error('Original WAV custody requires the shipping PCM decoder.'); } };
	const { controller, store } = await controllerSession(context, { engine: engine as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Selection custody must not replace a renderer or DSP pipeline.'); } });
	const { sampleRate } = input;
	await controller.actions.project.open(createSoundscaperProject({ id: `selection-${crypto.randomUUID()}`, sampleRate,
		tracks: [createAudioTrack({ id: 'empty', name: 'Track 1' })] }));
	await controller.actions.project.importFiles([input.file]);
	const fixture = mountControllerDataDom(), keys = new Set<EventListenerOrEventListenerObject>();
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) keys.delete(listener); };
	return { controller, store, fixture,
		async toolbar() { await fixture.render(<Toolbar controller={controller} fixture={fixture} />); },
		async key(key: string) { await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
			for (const listener of [...keys]) { if (typeof listener === 'function') listener(event); else listener.handleEvent(event); }
			await fixture.settle();
		}); },
		async commitDigit(digit: Parameters<typeof reactProps>[0]) { await act(async () => {
			reactProps(fixture.dom.one('[data-selection-toolbar]')).onKeyDownCapture({ key: 'Enter', target: digit });
			await fixture.settle();
		}); },
		async archive(assertGenerated: (name: string, channels: readonly Float32Array[]) => void = () => assert.fail('no generated source expected')) {
			await act(async () => { await controller.actions.project.flush(); });
			return await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
				if (name === input.file.name) assertPcmChannelsEqual(channels, input.pcm, 'every original RIFF16 sample'); else assertGenerated(name, channels);
			});
		},
		async dispose() {
			try { await fixture.dispose(); } finally {
				if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
			}
		},
	};
}
