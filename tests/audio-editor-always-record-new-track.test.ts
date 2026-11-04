/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1, validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import { planNewRecordingTracks } from '../src/common/editor/controller/recording/internal/new-recording-tracks.ts';
import { applySoundscaperProjectCommand as applyCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject as createAudioProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-audio-factory.js';
import { normalizeRecordingRouting } from '../src/common/editor/recording-routing.js';

test('always recording to new tracks is opt in and persists independently of input retention', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.equal(defaults.recording.alwaysRecordToNewTrack, false);
	const changed = updateAudioEditorPreferencesV1(defaults, { recording: { alwaysRecordToNewTrack: true } });
	assert.equal(loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(changed))).preferences.recording.alwaysRecordToNewTrack, true);
	assert.equal(updateAudioEditorPreferencesV1(changed, { recording: { retainInputs: false } }).recording.alwaysRecordToNewTrack, true);
	const legacy = { ...defaults, recording: { retainInputs: false } };
	assert.equal(validateAudioEditorPreferencesV1(legacy), true);
	assert.equal(loadAudioEditorPreferencesV1(legacy).preferences.recording.alwaysRecordToNewTrack, false);
	assert.throws(() => createAudioEditorPreferencesV1({ recording: { alwaysRecordToNewTrack: 'yes' } }), /alwaysRecordToNewTrack/u);
	assert.throws(() => validateAudioEditorPreferencesV1({ ...defaults, recording: { ...defaults.recording, alwaysRecordToNewTrack: 1 } }), /alwaysRecordToNewTrack/u);
});

function fixture() {
	const project = createAudioProject({ tracks: [
		createAudioTrack({ id: 'first', name: 'First', armed: true }),
		createAudioTrack({ id: 'unassigned', armed: true }),
		createAudioTrack({ id: 'second', name: 'Second', armed: true }),
		createAudioTrack({ id: 'inactive', armed: false }),
	] });
	// Stored object order deliberately differs from track order.
	const routing = normalizeRecordingRouting({ routes: {
		second: { kind: 'display', channelStart: 0, channelCount: 2 },
		first: { kind: 'device', deviceId: 'interface', channelStart: 2, channelCount: 1 },
		inactive: { kind: 'device', deviceId: 'interface', channelStart: 0, channelCount: 2 },
	}, offsets: { 'device:interface': -25, display: 40 } }, project.tracks);
	let id = 0;
	return { project, routing, createId: () => `new-${++id}` };
}

test('focused recording moves only the focused input to a new empty track', () => {
	const f = fixture();
	const plan = planNewRecordingTracks(f.project, f.routing, { trackId: 'second' }, f.createId, 'Recording');
	assert.ok(plan);
	const next = applyCommand(f.project, plan.command);
	assert.equal(next.tracks.length, 5);
	assert.equal(plan.options.trackId, 'new-1');
	assert.equal(next.tracks.at(-1)?.armed, true);
	assert.deepEqual(next.tracks.at(-1)?.clipIds, []);
	assert.equal(next.tracks.find(track => track.id === 'second')?.armed, false);
	assert.equal(next.tracks[0]?.armed, true);
	assert.deepEqual(plan.routing.routes['new-1'], f.routing.routes.second);
	assert.equal(plan.routing.routes.second, undefined);
	assert.deepEqual(plan.routing.routes.first, f.routing.routes.first);
	assert.deepEqual(plan.routing.offsets, f.routing.offsets);
});

test('multi-track recording transfers each armed assignment in track order on every take', () => {
	const f = fixture();
	const plan = planNewRecordingTracks(f.project, f.routing, {}, f.createId, 'Recording');
	assert.ok(plan);
	const next = applyCommand(f.project, plan.command);
	assert.deepEqual(next.tracks.slice(-2).map(track => track.name), ['First', 'Second']);
	assert.deepEqual(plan.routing.routes['new-1'], f.routing.routes.first);
	assert.deepEqual(plan.routing.routes['new-2'], f.routing.routes.second);
	assert.equal(plan.routing.routes.first, undefined);
	assert.equal(plan.routing.routes.second, undefined);
	assert.deepEqual(plan.routing.routes.inactive, f.routing.routes.inactive);
	assert.equal(plan.options.trackId, undefined);
	assert.deepEqual(normalizeRecordingRouting(plan.routing, next.tracks), plan.routing);
	const repeat = planNewRecordingTracks(next, plan.routing, {}, f.createId, 'Recording');
	assert.ok(repeat);
	assert.deepEqual(repeat.routing.routes['new-3'], f.routing.routes.first);
	assert.deepEqual(repeat.routing.routes['new-4'], f.routing.routes.second);
	assert.deepEqual(f.project.tracks.map(track => track.armed), [true, true, true, false]);
});

test('new-track planning preserves timed-start options and creates a focused track in an empty project', () => {
	const f = fixture();
	const options = { trackId: 'first', timedStartTimeMs: 100, timedEndTimeMs: 200, timedGeneration: 3, reusePreparedInputsOnly: true };
	const plan = planNewRecordingTracks(f.project, f.routing, options, f.createId, 'Recording');
	assert.deepEqual(plan?.options, { ...options, trackId: 'new-1' });
	const empty = createAudioProject({ tracks: [] });
	assert.ok(planNewRecordingTracks(empty, { routes: {}, offsets: {} }, { multitrack: false }, f.createId, 'Recording'));
	assert.equal(planNewRecordingTracks(empty, { routes: {}, offsets: {} }, {}, f.createId, 'Recording'), null);
});
