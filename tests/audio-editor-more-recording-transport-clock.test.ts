/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createEditorTransportService, type TransportServiceRuntime } from '../src/common/editor/controller/transport/internal/transport-service.ts';
import { createViewStateService, type ViewStateServiceRuntime } from '../src/common/editor/controller/transport/internal/view-state-service.ts';
import { calculateAudioEditorMetronomeSchedule } from '../src/common/editor/controller/transport/transport-model.ts';
import { createControllerTransportState } from '../src/common/editor/controller/transport/transport-state.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectDurationFrames } from '../src/common/editor/project.js';
import { appendRecordingPreview } from '../src/common/editor/controller/recording/recording-model.ts';
import { liveTimelinePositionFrame } from '../src/common/editor/ui/timeline/timeline-playback-frame-loop.ts';
import { MockAudioContext, MockParam } from './helpers/mock-audio-context.js';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

for (const metronomeEnabled of [true, false]) test(`ongoing capture retains its clock after finite backing playback ends (metronome initially ${metronomeEnabled ? 'on' : 'off'})`, async context => {
	context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
	const clicks: number[] = [];
	const audio = new MockAudioContext();
	Object.assign(audio, { createOscillator: () => ({ frequency: new MockParam(), connect() {}, disconnect() {},
		start: (when: number) => { clicks.push(when); }, stop() {}, onended: null }) });
	const createGain = audio.createGain.bind(audio);
	Object.assign(audio, { createGain: () => {
		const node = createGain();
		Object.assign(Reflect.get(node, 'gain') as object, { exponentialRampToValueAtTime() {} });
		return node;
	} });
	const capture = createRecordingCaptureFixture({ createRecorder: async () => ({
		start() {}, startConfirmed: async schedule => ({ startFrame: schedule.startFrame }),
		rescheduleConfirmed: async schedule => ({ startFrame: schedule.startFrame }),
		pause() {}, resume() {}, stop: async () => {}, setMonitoring() {}, setInputGain() {},
	}) });
	capture.state.recordingRouting = { routes: { 'track-1': {
		kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1,
	} }, offsets: {} };
	const project = createSoundscaperProject({ id: 'project-1', sampleRate: 48_000,
		tracks: [createAudioTrack({ id: 'track-1', clipIds: [], armed: true }, 48_000)] });
	const state = Object.assign(capture.state, createControllerTransportState(), { metronomeEnabled });
	const engine = createAudioEditorEngine({ audioContextFactory: () => audio as unknown as EngineAudioContext,
		onState: next => view.updateTransportState(next) });
	const transport = createEditorTransportService({ state, engine, getProject: () => project,
		AUDIO_EDITOR_SAMPLE_RATE: 48_000, calculateAudioEditorMetronomeSchedule,
		persistSetting: async () => {}, productSettingKey: (name: string) => name, publishDocumentSnapshot() {},
	} as unknown as TransportServiceRuntime);
	const view = createViewStateService({ state, getProject: () => project,
		projectDurationFrames,
		handleMicrophoneMeterTransportState() {}, syncMetronome: transport.syncMetronome,
		publishTelemetrySnapshot() {},
	} as unknown as ViewStateServiceRuntime);
	engine.loadProject(project);
	try {
		await createRoutedRecordingCaptureService({ ...capture.runtime, state, getProject: () => project,
			engine, updateTransportState: view.updateTransportState, appendPreview: appendRecordingPreview,
			updatePlayhead: () => view.updatePlayhead(),
		}).capture({ trackId: 'track-1' }, createScope(() => true));
		const audibleStart = engine.getPlaybackAudibleStartTime();
		assert.ok(audibleStart !== null);
		assert.equal(state.transportState, 'recording');
		// An empty project's backing engine plays its 30-second editor timeline.
		for (let tick = 1; tick <= 1320; tick++) {
			audio.currentTime = tick / 40;
			if (!metronomeEnabled && tick === 1244) {
				assert.equal(clicks.length, 0);
				transport.toggleMetronome();
			}
			context.mock.timers.tick(25);
			for (let turn = 0; turn < 8; turn++) await Promise.resolve();
			if (tick % 40 === 0) await capture.recorderOptions()!.onChunk({
				frameStart: (tick / 40 - 1) * 48_000, frames: 48_000, channels: [new Float32Array(48_000)],
			});
		}
		assert.ok(state.recorder, 'microphone capture remains active');
		assert.equal(engine.getState().state, 'stopped', 'the finite backing playback has completed');
		assert.equal(state.transportState, 'recording', 'backing playback cannot take ownership from capture');
		assert.equal(capture.writerRecords[0]?.writer.framesWritten, 33 * 48_000);
		assert.equal(liveTimelinePositionFrame(state, () => engine.getPositionFrames()), 33 * 48_000,
			'the visible playhead must advance with capture after backing playback ends');
		const afterEnd = clicks.filter(when => when >= 31);
		assert.ok(afterEnd.length >= 3, 'the metronome must continue beyond backing playback');
		for (const when of clicks) {
			assert.ok(Math.abs((when - audibleStart) * 2 - Math.round((when - audibleStart) * 2)) < 1e-7,
				`the recording click at ${when} must remain on its original beat grid`);
		}
	} finally {
		transport.stopMetronome();
		await engine.dispose();
		context.mock.timers.reset();
	}
});
