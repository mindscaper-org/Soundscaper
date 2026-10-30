import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createEditorTrackService } from '../src/common/editor/controller/track-audio/internal/track-service.ts';
import { planClipSpreadsheetEdits } from '../src/common/editor/clip-spreadsheet.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function service(project: ControllerProject, commit: (command: AudioEditorCommand) => void) {
	return createEditorTrackService({ lifetime: { assertActive() {} }, getProject: () => project, commit,
		copy: { track: 'Track', labels: 'Labels', recordingDesktopAudio: 'Desktop audio', trackDestinationInvalid: 'Invalid',
			trackNotFound: 'Missing', v2Required: 'Project required', audioTrackRequired: 'Audio required', unknownTrackDisplay: 'Unknown' },
		trackColors: ['blue'], getSelectedTrackId: () => null, editingBlocked: () => false, createId: prefix => prefix,
		getPositionFrames: () => 0, snapTimelineFrame: frame => frame, setTimelineView() {},
		recording: { defaultDeviceId: 'default', displaySourceKey: 'display', getRouting: () => ({ routes: {}, offsets: {} }),
			setRouting() {}, getPreferredDeviceId: () => 'default', getPreferredChannelCount: () => 1, getDevices: () => [], getPoolSources: () => [],
			setTrackRoute: routing => routing, setRouteHealth() {}, updateDeviceRows() {}, persistRouting: async () => undefined, publish() {} },
	});
}

test('moving a linked lane block reads each track group once and preserves the adjacent pair', () => {
	const pairs = 500;
	const base = createSoundscaperProject({ id: 'lane-groups', tracks: Array.from({ length: pairs }, (_, index) => [
		{ id: `video-${index}`, type: 'video', name: 'Picture', clipIds: [], laneGroupId: `pair-${index}` },
		{ id: `audio-${index}`, type: 'audio', name: 'Audio', clipIds: [], laneGroupId: `pair-${index}` },
	]).flat() });
	let reads = 0;
	const project = { ...base, tracks: base.tracks.map(track => ({ ...track, get laneGroupId() { reads++; return track.laneGroupId; } })) };
	const commands: AudioEditorCommand[] = [];
	assert.equal(service(project as unknown as ControllerProject, command => { commands.push(command); }).moveTrack('video-499', 'top'), 'video-499');
	assert.deepEqual(commands, [{ type: 'track/reorder', trackId: 'video-499', index: 0 }]);
	assert.ok(reads <= project.tracks.length * 4, `${reads} lane-group reads for ${pairs} pairs`);
});

test('spreadsheet multi-row destination edits share one current track index', () => {
	const count = 1_000;
	const project = projectForRuntimeConsumers(createSoundscaperProject({ id: 'spreadsheet-work',
		sources: [{ id: 'source', storageKey: 'source', channelCount: 1, sampleRate: 48_000, frameCount: 64 }],
		tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, clipIds: [`clip-${index}`] })),
		clips: Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })) }));
	let visits = 0;
	const original = Array.prototype.find;
	Array.prototype.find = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		return original.call(this, this === project.tracks ? (value: T, index: number, array: T[]) => {
			visits++; return predicate.call(receiver, value, index, array);
		} : predicate, receiver) as T | undefined;
	};
	try {
		const command = planClipSpreadsheetEdits(project, project.clips.map(clip => ({ clipId: clip.id, column: 'track', value: 'track-999' })));
		assert.equal(command?.type, 'clip/transform-many');
		if (command?.type !== 'clip/transform-many') assert.fail('Expected a batch transform');
		assert.equal(command.transforms.length, count - 1);
		assert.ok(command.transforms.every(transform => transform.trackId === 'track-999'));
		assert.ok(visits <= count * 2, `${visits} destination track comparisons`);
	} finally { Array.prototype.find = original; }
});
