/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorController, createCapturePool, createMockStream, createMockTrack, createProjectStore,
	createRecordingControllerFactory, createRecordingEngine, createFfmpegStub } from './audio-editor-recording-controller-harness.js';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';
import { deferred } from './async-test-control.ts';
import type { RecordingControllerFactoryOptions } from '../../src/common/editor/controller/recording/recording-transaction-types.ts';

function midiPitch(project: unknown): number | undefined {
	if (!project || typeof project !== 'object' || !('clips' in project) || !Array.isArray(project.clips)) return undefined;
	const clips: readonly unknown[] = project.clips;
	return clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])[0]?.pitch;
}

export async function midiRecordingPendingFixture(context: TestContext, options: Readonly<{
	configurePool?: (pool: ReturnType<typeof createCapturePool>) => ReturnType<typeof createCapturePool>;
}> = {}) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const actual = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const entered = deferred<void>(), release = deferred<void>(); let held = false;
	const store = new Proxy(actual, { get(target, key, receiver) {
		if (key === 'writeMidiSource') return async (...args: Parameters<typeof actual.writeMidiSource>) => {
			if (held) { entered.resolve(); await release.promise; }
			return target.writeMidiSource(...args);
		};
		const value: unknown = Reflect.get(target, key, receiver); return typeof value === 'function' ? value.bind(target) : value;
	} });
	let loaded: unknown = null, admittedPitch: number | undefined;
	const base = createRecordingEngine();
	const engine = { ...base, loadProject(project: unknown) { loaded = project; }, async applyProject(project: unknown) { loaded = project; },
		async playAt(...args: Parameters<typeof base.playAt>) { admittedPitch = midiPitch(loaded); await base.playAt(...args); this.state = base.state; } };
	const created: RecordingControllerFactoryOptions[] = [];
	const runtime = createSoundscaperProjectRuntimeSelection();
	const basePool = createCapturePool({ hardware: { default: createMockStream([createMockTrack('audio', { channelCount: 2 })]) } });
	const capturePool = options.configurePool?.(basePool) ?? basePool;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store, engine: engine as unknown as Options['engine'],
		ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: capturePool as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: createRecordingControllerFactory(created) });
	context.after(async () => { release.resolve(); await controller.actions.recording.stop(); await controller.dispose(); }); await controller.ready;
	const recordingTrackId = controller.getSnapshot().project?.tracks?.[0]?.id; assert.ok(typeof recordingTrackId === 'string');
	const { clipId } = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(clipId, { id: 'note', pitch: 60, velocity: 100, startFrame: 0, durationFrames: 4000, channel: 0 });
	await controller.actions.project.save();
	return { controller, clipId, recordingTrackId, created, release, get admittedPitch() { return admittedPitch; },
		get positionFrame() { return engine.positionFrame; }, get playCalls() { return engine.playCalls; },
		get loadedPitch() { return midiPitch(loaded); },
		async holdNoteEdit() {
			held = true;
			const editing = controller.actions.midi.updateNote(clipId, 'note', { pitch: 67 });
			const editOutcome = Promise.allSettled([editing]);
			await Promise.race([entered.promise, editing.then(() => {
				assert.fail('The MIDI edit completed before reaching the source-publication barrier.');
			})]);
			return { editing, editOutcome };
		},
	};
}
