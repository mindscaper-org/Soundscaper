import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { projectForCommand } from '../src/common/editor/command-project-view.ts';
import { createVideoSlipSlideService } from '../src/common/editor/controller/clip-video/internal/trim/video-slip-slide-service.ts';
import { resolveVideoSourceTimingViews } from '../src/common/editor/video-source-timing-views.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { prepareMediaNewTrackPlan } from '../src/common/editor/controller/clip-video/internal/clip/media-new-track-plan.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';

type Data = Record<string, unknown>;
function records(value: unknown): Data[] {
	assert.ok(Array.isArray(value));
	return value.map((item: unknown) => { assert.ok(item && typeof item === 'object' && !Array.isArray(item)); return item as Data; });
}
function fixture(count = 500, handles = false) {
	const options = framescaperV20Options();
	const clips = records(options.clips), tracks = records(options.tracks);
	const video = clips.find(clip => clip.kind === 'video')!, audio = clips.find(clip => clip.kind === 'audio')!;
	const videoTrack = tracks.find(track => track.type === 'video')!, audioTrack = tracks.find(track => track.type === 'audio')!;
	const nextClips = Array.from({ length: count }, (_, index) => [
		{ ...video, id: `v${index}`, avLinkId: `link${index}`, ...(handles ? { sourceInFrame: 1, sourceFrameCount: 8, sequenceFrameCount: 8 } : {}) },
		{ ...audio, id: `a${index}`, avLinkId: `link${index}`, ...(handles ? { sourceStartFrame: 4_800, sourceDurationFrames: 38_400, durationFrames: 38_400 } : {}) },
	]).flat();
	const nextTracks = Array.from({ length: count }, (_, index) => [
		{ ...videoTrack, id: `vt${index}`, laneGroupId: `lane${index}`, clipIds: [`v${index}`] },
		{ ...audioTrack, id: `at${index}`, laneGroupId: `lane${index}`, clipIds: [`a${index}`] },
	]).flat();
	return projectForCommand(createFramescaperProjectNativeMedia(PROFILE, { ...options, clips: nextClips, tracks: nextTracks,
		sequences: records(options.sequences).map(sequence => ({ ...sequence, trackIds: nextTracks.map(track => track.id) })),
		selection: { startFrame: 0, endFrame: 0, trackIds: nextTracks.map(track => track.id), clipIds: nextClips.map(clip => clip.id) } }));
}

const LINKED_PROJECT = fixture();

test('linked edge-trim planning indexes each video companion once for all selected pairs', () => {
	const project = LINKED_PROJECT;
	let visits = 0;
	const original = Array.prototype.filter;
	Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] {
		const measured = new Error().stack?.includes('frameCanonicalLinkedVideoCompanions');
		return original.call(this, measured ? (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); } : predicate, receiver) as T[];
	};
	try {
		const plan = planFrameCanonicalEdgeTrim(project, { activeClipId: 'v0', edge: 'left', requestedBoundarySample: 4_800 });
		assert.equal(plan.kind, 'transform');
		if (plan.kind !== 'transform') assert.fail('Expected a legal trim');
		assert.equal(plan.transforms.length, 1_000);
		assert.ok(visits < 2_000, `${visits} video companion comparisons`);
	} finally { Array.prototype.filter = original; }
});

test('linked new-track planning shares selected media, companion and sequence ownership indexes', () => {
	const project = LINKED_PROJECT as unknown as ClipTransformProject;
	let clipVisits = 0, trackVisits = 0, id = 0;
	const some = Array.prototype.some, find = Array.prototype.find;
	Array.prototype.some = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): boolean {
		return some.call(this, this === project.clips ? (value: T, index: number, array: T[]) => { clipVisits++; return predicate.call(receiver, value, index, array); } : predicate, receiver);
	};
	Array.prototype.find = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		return find.call(this, this === project.tracks ? (value: T, index: number, array: T[]) => { trackVisits++; return predicate.call(receiver, value, index, array); } : predicate, receiver) as T | undefined;
	};
	try {
		const result = prepareMediaNewTrackPlan(project, project.clips, prefix => `${prefix}-${++id}`, 'Audio');
		assert.equal(result.commands.length, 1_000);
		assert.equal(result.destinationTrackIds.size, 1_000);
		const sequenceId = records(project.sequences)[0]!.id;
		assert.ok(result.commands.every(command => command.type === 'track/add' && command.sequenceId === sequenceId));
		assert.ok(clipVisits < 2_000, `${clipVisits} selected-video comparisons`);
		assert.ok(trackVisits < 2_000, `${trackVisits} audio companion comparisons`);
	} finally { Array.prototype.some = some; Array.prototype.find = find; }
});


test('actual multi-track slip preview checks each participant track without repeated representative searches', () => {
	const project = fixture(200, true);
	const service = createVideoSlipSlideService({ lifetime: { assertActive() {} }, getProject: () => project,
		getTimingViews: resolveVideoSourceTimingViews, editingBlocked: () => false, commit: () => assert.fail('Preview must not commit') });
	let visits = 0;
	const original = Array.prototype.find;
	Array.prototype.find = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		const measured = new Error().stack?.includes('preflightParticipants');
		return original.call(this, measured ? (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); } : predicate, receiver) as T | undefined;
	};
	try {
		const plan = service.preview({ mode: 'slip', activeClipId: 'v0', requestedSourceInFrame: 2 });
		assert.equal(plan.kind, 'transform');
		if (plan.kind !== 'transform') assert.fail('Expected an admitted source slip');
		assert.equal(plan.transforms.length, 400);
		assert.ok(visits <= 800, `${visits} participant track comparisons`);
	} finally { Array.prototype.find = original; }
});
