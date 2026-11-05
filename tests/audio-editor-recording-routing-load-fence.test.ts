/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { normalizeRecordingRouting } from '../src/common/editor/recording-routing.js';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

test('a late project routing read cannot replace the active tab recording routes', async () => {
	const first = createAudioEditorProjectV17({ id: 'first', tracks: [createAudioTrack({ id: 'first-track' })] });
	const second = createAudioEditorProjectV17({ id: 'second', tracks: [createAudioTrack({ id: 'second-track' })] });
	const oldRead = deferred<unknown>();
	const secondRouting = { routes: { 'second-track': { kind: 'device', deviceId: 'second-mic', channelStart: 0, channelCount: 1 } }, offsets: {} };
	const f = createFixture({ project: first, normalizeRouting: normalizeRecordingRouting,
		loadSetting: async key => key === 'routing:first' ? oldRead.promise : secondRouting });
	const oldLoading = f.service.loadRecordingRouting();
	f.setProject(second);
	await f.service.loadRecordingRouting();
	assert.ok(f.state.recordingRouting.routes['second-track']);
	oldRead.resolve({ routes: { 'first-track': { kind: 'device', deviceId: 'first-mic', channelStart: 0, channelCount: 1 } }, offsets: {} });
	await oldLoading;
	assert.ok(f.state.recordingRouting.routes['second-track'], 'the current tab keeps its own recording input');
	assert.equal(f.state.recordingRouting.routes['first-track'], undefined);
});
