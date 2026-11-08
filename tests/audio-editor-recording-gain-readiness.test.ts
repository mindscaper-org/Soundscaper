/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { deferred } from './helpers/async-test-control.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub, createMockStream,
	createMockTrack, createProjectStore, createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

for (const routed of [false, true]) {
	for (const gain of [0, .4]) test(`${routed ? 'routed' : 'default'} capture adopts latest gain ${gain} before starting its prepared recorder`, async context => {
		const fixture = await gainFixture(context, routed);
		const starting = fixture.controller.actions.recording.start({ trackId: fixture.trackId });
		await fixture.entered.promise;
		fixture.controller.actions.recording.setLevel(.8);
		fixture.controller.actions.recording.setLevel(.2);
		fixture.controller.actions.recording.setLevel(gain);
		assert.equal(fixture.controller.getSnapshot().recordingOptions.inputGain, gain);
		fixture.release.resolve();
		await starting;
		assert.deepEqual(fixture.records[0]?.startGains, [gain], 'the first captured frame uses the displayed level');
		assert.equal(fixture.records[0]?.gain, gain);
	});

	test(`${routed ? 'routed' : 'default'} capture retains saved gain and subsequent live changes`, async context => {
		const fixture = await gainFixture(context, routed);
		assert.equal(fixture.controller.getSnapshot().recordingOptions.inputGain, .25);
		const starting = fixture.controller.actions.recording.start({ trackId: fixture.trackId });
		await fixture.entered.promise;
		fixture.release.resolve();
		await starting;
		assert.deepEqual(fixture.records[0]?.startGains, [.25]);
		fixture.controller.actions.recording.setLevel(.6);
		assert.equal(fixture.records[0]?.gain, .6);
	});

	test(`${routed ? 'routed' : 'default'} Stop retires a pending recorder before a later gain can start it`, async context => {
		const fixture = await gainFixture(context, routed);
		const starting = fixture.controller.actions.recording.start({ trackId: fixture.trackId });
		await fixture.entered.promise;
		const stopping = fixture.controller.actions.transport.stop();
		fixture.controller.actions.recording.setLevel(0);
		fixture.release.resolve();
		await Promise.all([starting, stopping]);
		assert.deepEqual(fixture.records[0]?.startGains, []);
		assert.deepEqual(fixture.records[0]?.updates, [], 'retired controllers receive no late handoff');
		assert.equal(fixture.records[0]?.disposed, true);
		assert.equal(fixture.controller.getSnapshot().recording, false);
	});
}

interface GainRecord {
	gain: number;
	disposed: boolean;
	readonly startGains: number[];
	readonly updates: number[];
}

async function gainFixture(context: TestContext, routed: boolean) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	await store.saveSetting('recording-input-gain', .25);
	const entered = deferred<void>(), release = deferred<void>();
	const records: GainRecord[] = [];
	const options: RecordingControllerFactoryOptions[] = [];
	const createRecorder = createRecordingControllerFactory(options);
	const controller = createAudioEditorController(null, {
		headless: true, store,
		engine: createRecordingEngine() as unknown as Options['engine'],
		ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: {
			default: createMockStream([createMockTrack('audio', { channelCount: 1 })]),
		} }) as unknown as Options['recordingCapturePool'],
		async recordingControllerFactory(configuration) {
			const record: GainRecord = { gain: configuration.inputGain ?? 1, disposed: false, startGains: [], updates: [] };
			records.push(record);
			entered.resolve();
			await release.promise;
			const recorder = await createRecorder(configuration);
			return {
				...recorder,
				start(startOptions) { record.startGains.push(record.gain); recorder.start(startOptions); },
				setInputGain(value) { record.gain = value; record.updates.push(value); },
				async dispose() { record.disposed = true; await recorder.dispose(); },
			};
		},
	});
	context.after(async () => {
		release.resolve();
		await controller.actions.recording.stop();
		await controller.dispose();
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project?.tracks?.[0]?.id;
	assert.ok(typeof trackId === 'string');
	if (routed) await controller.actions.recording.setTrackInput(trackId, {
		kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1,
	});
	return { controller, trackId, records, entered, release };
}
