/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createTakeCompPreviewService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-preview-service.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createTakeFitProject } from './helpers/take-fit-project.ts';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';
import { waitFor } from './helpers/async-test-control.ts';

function fixture(t: TestContext, offset = false) {
	const base = createTakeFitProject();
	const project = createSoundscaperProject({ ...base, takeGroups: [{
		id: 'group', sequenceId: 'main', trackId: 'track', startSample: 480_000, endSample: 576_000,
		laneOrder: ['lane'], lanes: [{ id: 'lane' }],
		takes: [{ id: 'take', laneId: 'lane', sourceId: 'take-source', sourceStartSample: offset ? 12_000 : 0,
			startSample: offset ? 504_000 : 480_000, endSample: offset ? 552_000 : 576_000 }],
		compRegions: [{ id: 'comp', takeId: 'take', startSample: offset ? 504_000 : 480_000,
			endSample: offset ? 552_000 : 576_000 }],
	}] });
	const original = structuredClone(project);
	const lifetime = new EditorControllerLifetime(), generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context);
	const sourceBuffers = new Map<string, AudioBuffer>();
	for (const source of project.sources) {
		assert.equal(source.kind, 'audio');
		if (source.kind !== 'audio') throw new TypeError('The fixture requires audio media.');
		const samples = new Float32Array(source.frameCount).fill(.1);
		sourceBuffers.set(source.id, {
			sampleRate: source.sampleRate, length: source.frameCount, numberOfChannels: 1,
			duration: source.frameCount / source.sampleRate, getChannelData: () => samples,
			copyFromChannel: (output, _channel, start = 0) => { output.set(samples.subarray(start, start + output.length)); },
			copyToChannel: (input, _channel, start = 0) => { samples.set(input, start); },
		});
	}
	const service = createTakeCompService({ lifetime, getProject: () => project,
		editingBlocked: () => false, commit: () => assert.fail('An audition cannot mutate the document.') });
	const preview = createTakeCompPreviewService({ lifetime, service, sourceBuffers, sourceChunkProviders: new Map(),
		getProject: () => project, createId: prefix => `${prefix}-preview`,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		stopPlayback() {}, createPreviewEngine: ({ onState }) => { engine.subscribeState(onState); return engine; },
	});
	t.after(async () => { await preview.dispose(); await engine.dispose(); assert.deepEqual(project, original); });
	return { preview, engine, context };
}

for (const kind of ['take', 'lane'] as const) for (const offset of [false, true]) {
	test(`${kind} audition ends at its ${offset ? 'offset and trimmed' : 'full'} media extent and replays`, async t => {
		const f = fixture(t, offset);
		const play = () => kind === 'take' ? f.preview.auditionTake('group', 'take') : f.preview.auditionLane('group', 'lane');
		await play();
		const end = offset ? 72_000 : 96_000;
		assert.equal(f.engine.getState().playbackEndFrame, end);
		const start = f.engine.getPlaybackAudibleStartTime();
		assert.ok(start !== null);
		f.context.currentTime = start + end / 48_000 + .01;
		await waitFor(() => f.engine.getState().state === 'stopped', 'the finite take audition to finish');
		assert.equal((await play()).state, 'playing', 'a natural end retires the previous toggle state');
		assert.equal(f.engine.getPositionFrames(), 0);
	});
}

test('Take Pause/Resume preserves its position and restores the finite range', async t => {
	const f = fixture(t);
	await f.preview.auditionTake('group', 'take');
	f.context.currentTime += .2;
	assert.equal((await f.preview.auditionTake('group', 'take')).state, 'paused');
	const pausedPosition = f.engine.getPositionFrames();
	assert.equal((await f.preview.auditionTake('group', 'take')).state, 'playing');
	assert.equal(f.engine.getPositionFrames(), pausedPosition);
	assert.equal(f.engine.getState().playbackEndFrame, 96_000);
});

test('explicit Stop retires a Take audition and the next request starts from zero', async t => {
	const f = fixture(t);
	await f.preview.auditionTake('group', 'take');
	f.context.currentTime += .2;
	await f.preview.stop();
	assert.equal((await f.preview.auditionTake('group', 'take')).state, 'playing');
	assert.equal(f.engine.getPositionFrames(), 0);
});
