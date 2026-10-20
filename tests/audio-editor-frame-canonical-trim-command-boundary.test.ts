/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { planFrameCanonicalRollRippleTrim } from '../src/common/editor/frame-canonical-roll-ripple-trim-planner.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 40_000, den: 1 });
const NOW = '2026-08-11T21:00:00.000Z';

test('an edge plan round-trips canonical video placement when sample deltas alias frame deltas', () => {
	const project = highRateProject(false);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalEdgeTrim(runtime, {
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(3),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.deepEqual(
		plan.transforms[0]?.sequencePlacement,
		{ sequenceStartFrame: 0, sequenceFrameCount: 3 },
	);

	const command = serializableCommand(prepareTransformClipsCommand(runtime, plan.transforms));
	assert.equal(command.type, 'clip/transform-many');
	if (command.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	assert.deepEqual(command.transforms[0]?.sequencePlacement, {
		sequenceStartFrame: 0,
		sequenceFrameCount: 3,
	});
	let history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	assertCanonicalPlacement(history.present, 'active-video', 0, 3);
	assertResolvedPreviews(history.present, plan.previews);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);

	const edited = canonicalCoordinates(history.present);
	history = undoEditorCommand(history, { now: '2026-08-11T21:01:00.000Z' });
	assert.deepEqual(canonicalCoordinates(history.present), canonicalCoordinates(project));
	history = redoEditorCommand(history, { now: '2026-08-11T21:02:00.000Z' });
	assert.deepEqual(canonicalCoordinates(history.present), edited);
});

for (const row of [
	{
		mode: 'roll' as const,
		expected: [['active-video', 0, 3], ['suffix-video', 3, 1]] as const,
	},
	{
		mode: 'ripple' as const,
		expected: [['active-video', 0, 3], ['suffix-video', 3, 2]] as const,
	},
]) test(`a ${row.mode} plan round-trips every canonical video placement at 48k/40k`, () => {
	const project = highRateProject(true);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalRollRippleTrim(runtime, {
		mode: row.mode,
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(3),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.deepEqual(plan.transforms.map(({ sequencePlacement }) => sequencePlacement), row.expected.map(([
		, sequenceStartFrame, sequenceFrameCount,
	]) => ({
		sequenceStartFrame,
		sequenceFrameCount,
	})));

	const command = serializableCommand(prepareTransformClipsCommand(runtime, plan.transforms));
	const history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	for (const [clipId, sequenceStartFrame, sequenceFrameCount] of row.expected) {
		assertCanonicalPlacement(history.present, clipId, sequenceStartFrame, sequenceFrameCount);
	}
	assertResolvedPreviews(history.present, plan.previews);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
});

test('canonical placement refuses an absolute sample alias mismatch during preparation', () => {
	const project = highRateProject(false);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	assert.throws(() => prepareTransformClipsCommand(runtime, [{
		clipId: 'active-video',
		trackId: 'video-track',
		changes: { durationFrames: boundary(3) },
		sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 2 },
	}]), /canonical|sequence placement|alias/iu);
});

test('generic and overwrite transform preparation retain the legacy transform shape', () => {
	const project = highRateProject(false);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const input = [{
		clipId: 'active-video',
		trackId: 'video-track',
		changes: { timelineStartFrame: boundary(0) },
	}];
	for (const overwrite of [false, true]) {
		const command = prepareTransformClipsCommand(runtime, input, { overwrite }) as AudioEditorCommand;
		assert.equal(command.type, 'clip/transform-many');
		if (command.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
		assert.deepEqual(command.transforms, input);
		assert.equal(Object.hasOwn(command.transforms[0]!, 'sequencePlacement'), false);
	}
});

function highRateProject(withSuffix: boolean) {
	const source = createVideoSource({
		id: 'video-source',
		frameCount: 120,
		sampleRate: SAMPLE_RATE,
		width: 16,
		height: 16,
		frameRate: RATE,
		sourceFrameCount: 100,
	}, SAMPLE_RATE);
	const clip = (
		id: string,
		sequenceStartFrame: number,
		sequenceFrameCount: number,
		sourceInFrame: number,
	) => createVideoClip({
		id,
		sourceId: 'video-source',
		sequenceId: 'main',
		sequenceStartFrame,
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount: sequenceFrameCount,
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: RATE },
		source,
	});
	const clips = [
		clip('active-video', 0, 2, 0),
		...(withSuffix ? [clip('suffix-video', 2, 2, 10)] : []),
	];
	const track = createVideoTrack({
		id: 'video-track',
		clipIds: clips.map(({ id }) => String(id)),
		locked: false,
	});
	return createCurrentAudioEditorProject({
		id: `high-rate-${withSuffix ? 'pair' : 'edge'}`,
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main',
		sources: [source],
		clips,
		tracks: [track],
	});
}

function serializableCommand(value: unknown): AudioEditorCommand {
	return JSON.parse(JSON.stringify(value)) as AudioEditorCommand;
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, RATE, SAMPLE_RATE, 'point');
}

function assertCanonicalPlacement(
	project: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>,
	clipId: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
): void {
	const clip = project.clips.find(({ id }) => id === clipId);
	assert.ok(clip);
	assert.deepEqual([clip.sequenceStartFrame, clip.sequenceFrameCount], [
		sequenceStartFrame,
		sequenceFrameCount,
	]);
	assert.equal(Object.hasOwn(clip, 'sequencePlacement'), false);
}

function assertResolvedPreviews(
	project: Readonly<Record<string, unknown>>,
	previews: readonly Readonly<{
		clipId: string;
		timelineStartFrame: number;
		durationFrames: number;
		sourceStartFrame: number;
		sourceDurationFrames: number;
	}>[],
): void {
	const clips = resolveRuntimeProjectProjection(project).clips;
	for (const preview of previews) {
		const clip = clips.find(({ id }) => id === preview.clipId);
		assert.ok(clip);
		assert.deepEqual([
			clip.timelineStartFrame,
			clip.durationFrames,
			clip.sourceStartFrame,
			clip.sourceDurationFrames,
		], [
			preview.timelineStartFrame,
			preview.durationFrames,
			preview.sourceStartFrame,
			preview.sourceDurationFrames,
		], String(preview.clipId));
	}
}

function canonicalCoordinates(
	project: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>,
): readonly unknown[] {
	return project.clips.map((clip) => ({
		id: clip.id,
		sequenceStartFrame: clip.sequenceStartFrame,
		sequenceFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame,
		sourceFrameCount: clip.sourceFrameCount,
	}));
}
