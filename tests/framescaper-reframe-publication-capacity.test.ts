/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { resolveLocalAssistanceSelectedVideoAuthority } from '../src/common/editor/controller/assistance/local-assistance-selected-video.ts';
import { createLocalAssistanceSelectedVideoTimingBinding, createLocalAssistanceSelectedVideoReframeFramePackTiming } from '../src/common/editor/controller/assistance/internal/selected-video/local-assistance-selected-video-timing.ts';
import { createFramescaperAssistanceReframePublication } from '../src/framescaper/editor-local-assistance-reframe-publication.ts';
import { planOwnedCropsV1 } from '../src/common/editor/assistance/owned-video-workflow-transforms-v1.ts';
import { reframePublicationSampleBudget } from '../src/common/editor/assistance/reframe-publication-capacity.ts';
import { countAudioEditorProjectValidationStructure, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../src/common/editor/project-validation-budget.ts';

function fixture() {
	const frames = 20_485;
	const project = createFramescaperProject(PROFILE, { id: 'long-reframe', sampleRate: 48_000,
		sources: [{ kind: 'video', id: 'video', storageKey: 'video', name: 'Long recording', mimeType: 'video/webm', contentSha256: 'ab'.repeat(32), width: 32, height: 24, frameRate: { num: 10, den: 1 }, frameCount: frames * 4_800, sampleFrameCount: frames * 4_800, sourceFrameCount: frames }],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'video', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: frames, sourceInFrame: 0, sourceFrameCount: frames, retimeMap: null }],
		tracks: [{ id: 'track', type: 'video', clipIds: ['clip'] }], sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['track'] }], primarySequenceId: 'main-sequence', selection: { startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: ['clip'] } });
	const selection = resolveLocalAssistanceSelectedVideoAuthority({ getProject: () => project, getSelectedClipId: () => 'clip' });
	const timing = createLocalAssistanceSelectedVideoTimingBinding(selection.project, selection.clip, selection.source, selection.sequence,
		{ sequenceStart: 0, sequenceEnd: frames, sequenceCount: frames, sourceStart: 0, sourceEnd: frames });
	const fence = { fenceVersion: 1 as const, schemaFamily: selection.fence.schemaFamily, schemaVersion: selection.fence.schemaVersion,
		projectId: project.id, revision: project.revision, sequenceId: selection.fence.sequenceId,
		sourceRanges: [{ slotId: 'primary-video', mediaKind: 'video' as const, sourceId: selection.source.id as string, sourceSha256: selection.fence.sourceSha256,
			sourceSampleRate: null, occurrenceIds: selection.fence.occurrenceIds, sourceStartFrame: 0, sourceEndFrame: frames, linkMembershipSha256: selection.fence.linkMembershipSha256,
			timingAuthoritySha256: selection.fence.timingAuthoritySha256, retimeKind: 'identity' as const }],
		transcriptBodySha256: null, recipeSha256: '12'.repeat(32), settingsSha256: '34'.repeat(32), modelBindingsSha256: '56'.repeat(32) };
	return { project, selection, timing, fence };
}

test('a reviewed 4097-sample constant Reframe publishes the exact static crop within project limits', async () => {
	const subject = fixture();
	const sampled = createLocalAssistanceSelectedVideoReframeFramePackTiming(subject.timing, []);
	assert.equal(sampled.frames.length, 4_097);
	const authority = { width: 32, height: 24, timescale: sampled.timescale };
	const tracked = { schemaVersion: 1, ...authority, frames: sampled.frames.map(frame => ({ sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick, subjects: [] })) };
	const saliency = { schemaVersion: 1, ...authority, frames: sampled.frames.map(frame => ({ sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick, saliency: null })) };
	const result = planOwnedCropsV1({ 'tracked-subjects': tracked, 'saliency-map': saliency }, { targetAspectWidth: 9, targetAspectHeight: 16 } as Parameters<typeof planOwnedCropsV1>[1]);
	let current = subject.project; let commits = 0;
	const publication = createFramescaperAssistanceReframePublication({ currentAuthority: () => ({ selection: subject.selection, fence: subject.fence }),
		captureProject: () => current, assertProject: token => { assert.equal(token, current); },
		commit(command) { current = applyFramescaperProjectCommand(PROFILE, current, command); commits += 1; } });
	await publication.acceptReviewed({ fence: subject.fence, result });
	assert.equal(commits, 1);
	assert.ok(validateFramescaperProject(PROFILE, current));
	const clip = current.clips.find(clip => clip.id === 'clip')!;
	assert.deepEqual((clip.videoComposition as { crop: unknown }).crop, result.path.keyframes[0]!.crop);
	assert.equal((clip.videoKeyframes as { curves: unknown[] }).curves.length, 0);
});

test('irreducible long Reframes sample the complete clip within its actual publication budget', async () => {
	const subject = fixture();
	const budget = reframePublicationSampleBudget(subject.selection.project, subject.selection.clip);
	assert.ok(budget >= 2 && budget <= 4_096);
	const atCapacity = createLocalAssistanceSelectedVideoReframeFramePackTiming(subject.timing, [20_479], budget);
	assert.equal(atCapacity.frames.length, budget);
	const capacityCurves = ['left', 'right', 'top', 'bottom'].map(parameter => ({ target: { kind: 'composition', parameterId: `crop.${parameter}` }, curve: {
		anchors: atCapacity.frames.map(frame => ({ position: { num: frame.sourceFrame, den: 1 }, value: 0 })),
		segments: Array.from({ length: budget - 1 }, () => ({ kind: 'linear' })),
	} }));
	const maximumProject = { ...subject.project, clips: subject.project.clips.map(clip => clip.id === 'clip'
		? { ...clip, videoKeyframes: { ...(clip.videoKeyframes as object), curves: capacityCurves } } : clip) };
	assert.ok(countAudioEditorProjectValidationStructure(maximumProject, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS) <= 100_000);
	const sampled = createLocalAssistanceSelectedVideoReframeFramePackTiming(subject.timing, [20_479], Math.min(32, budget));
	assert.equal(sampled.frames[0]!.sourceFrame, 0);
	assert.equal(sampled.frames.at(-1)!.sourceFrame, 20_480);
	assert.ok(sampled.frames.some(frame => frame.sourceFrame === 20_479));
	const authority = { width: 32, height: 24, timescale: sampled.timescale };
	const tracked = { schemaVersion: 1, ...authority, frames: sampled.frames.map(frame => ({ sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick, subjects: [] })) };
	const saliency = { schemaVersion: 1, ...authority, frames: sampled.frames.map((frame, index) => ({ sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick, saliency: { x: index % 2 ? 0.2 : 0.8, y: 0.5, score: 1 } })) };
	const result = planOwnedCropsV1({ 'tracked-subjects': tracked, 'saliency-map': saliency }, { targetAspectWidth: 9, targetAspectHeight: 16 } as Parameters<typeof planOwnedCropsV1>[1]);
	let current = subject.project;
	const publication = createFramescaperAssistanceReframePublication({ currentAuthority: () => ({ selection: subject.selection, fence: subject.fence }),
		captureProject: () => current, assertProject: token => { assert.equal(token, current); },
		commit(command) { current = applyFramescaperProjectCommand(PROFILE, current, command); } });
	await publication.acceptReviewed({ fence: subject.fence, result });
	assert.ok(validateFramescaperProject(PROFILE, current));
	const curves = current.clips.find(clip => clip.id === 'clip')!.videoKeyframes as { curves: { curve: { anchors: unknown[] } }[] };
	assert.equal(curves.curves.length, 4);
	assert.ok(curves.curves.every(curve => curve.curve.anchors.length === sampled.frames.length), 'every reviewed changing crop is retained');
	assert.throws(() => createLocalAssistanceSelectedVideoReframeFramePackTiming(subject.timing, Array.from({ length: budget + 1 }, (_, index) => index), budget), /shot anchors exceed/u);
});
