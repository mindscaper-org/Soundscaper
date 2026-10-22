/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioEditorMetronomeSchedule } from '../src/common/editor/controller/transport/transport-model.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext, MockParam } from './helpers/mock-audio-context.js';

for (const bpm of [123, 127, 137]) test(`Play from the rounded ${bpm} BPM bar boundary sounds its downbeat`, async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const clicks: Array<{ when: number; frequency: number }> = [];
	const previous = globalThis.AudioContext;
	class AudioContextFixture extends MockAudioContext {
		createOscillator() {
			const frequency = new MockParam();
			return { frequency, connect() {}, disconnect() {}, onended: null,
				start: (when: number) => { clicks.push({ when, frequency: frequency.value }); }, stop() {} };
		}
		createGain() {
			const node = super.createGain();
			Object.assign(Reflect.get(node, 'gain') as object, { exponentialRampToValueAtTime() {} });
			return node;
		}
	}
	globalThis.AudioContext = AudioContextFixture as unknown as typeof AudioContext;
	context.after(() => { globalThis.AudioContext = previous; });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const project = createSoundscaperProject({ id: `rounded-beat-${bpm}`, sampleRate: 48_000,
		tempo: { bpm, timeSignature: { numerator: 4, denominator: 4 } },
		tracks: [createAudioTrack({ id: 'track', clipIds: [] })] });
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	const barFrame = Math.round(4 * 60 * 48_000 / bpm);
	controller.actions.transport.seek(barFrame);
	controller.actions.transport.toggleMetronome();
	await controller.actions.transport.playPause();
	for (let turn = 0; turn < 30; turn++) await Promise.resolve();
	assert.equal(clicks.length, 1, 'starting on the stored sample-frame downbeat must not skip to beat two');
	assert.equal(clicks[0]!.frequency, 1320, 'the first click is the bar accent');
	const schedule = calculateAudioEditorMetronomeSchedule({ bpm, sampleRate: 48_000,
		positionFrame: barFrame, timeSignature: { numerator: 4, denominator: 4 } });
	assert.equal(schedule.delaySeconds, 0);
	assert.equal(schedule.accent, 'bar');
	assert.equal(calculateAudioEditorMetronomeSchedule({ bpm, sampleRate: 48_000,
		positionFrame: barFrame + 1 }).beatIndex, 5, 'one frame after a pulse waits for the next beat');
});
