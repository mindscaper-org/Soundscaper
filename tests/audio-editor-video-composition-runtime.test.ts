/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoCompositionRuntimeHandlers } from '../src/common/editor/commands/video-composition-runtime.ts';
import type { VideoCompositionCommand } from '../src/common/editor/commands/video-composition.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';

const apply = createVideoCompositionRuntimeHandlers()['video-composition/set'];

function videoClip(id: string) {
	return {
		id, kind: 'video', sourceId: `source-${id}`, sequenceStartFrame: 12,
		videoComposition: structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		videoKeyframes: { curves: ['retained-keyframe-path'] },
	};
}

function projectFixture() {
	return {
		clips: [videoClip('timeline-video')],
		projectBin: { clips: [videoClip('bin-video')] },
	};
}

function command(clipId = 'timeline-video'): VideoCompositionCommand {
	return {
		type: 'video-composition/set', clipId,
		expectedComposition: structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		composition: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION), opacity: 0.4,
			crop: { left: 0.1, top: 0.2, right: 0.05, bottom: 0.1 },
			transform: {
				...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
				positionX: 0.75, rotationDegrees: 15,
			},
		},
	};
}

test('composition edits target timeline and Project Bin clips without sharing mutable command data', () => {
	for (const location of ['timeline', 'bin'] as const) {
		const project = projectFixture();
		const target = location === 'timeline' ? project.clips[0]! : project.projectBin.clips[0]!;
		const other = location === 'timeline' ? project.projectBin.clips[0]! : project.clips[0]!;
		const otherBefore = structuredClone(other);
		const keyframesBefore = target.videoKeyframes;
		const edit = command(target.id);

		apply(project, edit);

		assert.deepEqual(target.videoComposition, edit.composition);
		assert.notStrictEqual(target.videoComposition, edit.composition);
		assert.notStrictEqual(target.videoComposition.crop, edit.composition.crop);
		assert.notStrictEqual(target.videoComposition.transform, edit.composition.transform);
		assert.equal(Object.isFrozen(target.videoComposition), true);
		assert.equal(Object.isFrozen(target.videoComposition.crop), true);
		assert.equal(Object.isFrozen(target.videoComposition.transform), true);
		assert.strictEqual(target.videoKeyframes, keyframesBefore);
		assert.equal(target.sourceId, `source-${target.id}`);
		assert.equal(target.sequenceStartFrame, 12);
		assert.deepEqual(other, otherBefore);
	}
});

test('an optimistic composition edit refuses to overwrite a newer edit', () => {
	const project = projectFixture();
	const stale = command();
	apply(project, { ...command(), composition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: 0.7 } });
	const before = structuredClone(project);

	assert.throws(() => apply(project, stale), /composition changed before the edit was committed/iu);
	assert.deepEqual(project, before);

	apply(project, {
		...stale, expectedComposition: project.clips[0]!.videoComposition,
	});
	assert.equal(project.clips[0]!.videoComposition.opacity, 0.4);
});

test('an invalid replacement composition is rejected before any clip data changes', () => {
	const project = projectFixture();
	const before = structuredClone(project);
	const edit = command();
	const invalid = {
		...edit, composition: {
			...edit.composition, crop: { ...edit.composition.crop, left: 0.8, right: 0.4 },
		},
	};

	assert.throws(() => apply(project, invalid), /left plus.*right must be less than 1/iu);
	assert.deepEqual(project, before);
});

test('duplicate clip identities cannot select an arbitrary composition owner', () => {
	for (const duplicateLocation of ['timeline', 'bin'] as const) {
		const project = projectFixture();
		const collection = duplicateLocation === 'timeline' ? project.clips : project.projectBin.clips;
		collection.push(videoClip('timeline-video'));
		const before = structuredClone(project);

		assert.throws(() => apply(project, command()), /clip ID timeline-video is not globally unique/iu);
		assert.deepEqual(project, before);
	}
});

test('composition edits reject missing and audio clip targets without changing the project', () => {
	const project = projectFixture();
	project.clips.push({ ...videoClip('audio-clip'), kind: 'audio' });
	const before = structuredClone(project);

	assert.throws(() => apply(project, command('deleted-video')), /Video clip deleted-video is missing/iu);
	assert.throws(() => apply(project, command('audio-clip')), /Clip audio-clip is not a video clip/iu);
	assert.deepEqual(project, before);
});

test('composition target discovery rejects accessor-backed project fields without invoking them', () => {
	for (const field of ['clips', 'projectBin'] as const) {
		const project = projectFixture();
		let reads = 0;
		Object.defineProperty(project, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('unexpected project getter execution'); },
		});

		assert.throws(() => apply(project, command()), /own enumerable data property/iu);
		assert.equal(reads, 0);
	}
});

test('composition edits reject accessor-backed clip identity, kind and current composition', () => {
	for (const field of ['id', 'kind', 'videoComposition'] as const) {
		const project = projectFixture();
		const clip = project.clips[0]!;
		const compositionBefore = clip.videoComposition;
		let reads = 0;
		Object.defineProperty(clip, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('unexpected clip getter execution'); },
		});

		assert.throws(() => apply(project, command()), /own enumerable data property/iu);
		assert.equal(reads, 0);
		if (field !== 'videoComposition') assert.strictEqual(clip.videoComposition, compositionBefore);
	}
});
