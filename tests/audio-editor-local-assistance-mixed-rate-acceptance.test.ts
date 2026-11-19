/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalAssistanceTranscriptAcceptance } from '../src/common/editor/controller/assistance/internal/local-assistance-transcript-acceptance.ts';
import { createLocalAssistanceRangeLabelAcceptance } from '../src/common/editor/controller/assistance/internal/local-assistance-range-label-acceptance.ts';
import { createLocalAssistanceReactionReviewSession } from '../src/common/editor/controller/assistance/internal/local-assistance-reaction-acceptance.ts';
import { createLocalAssistanceBeatReviewSession } from '../src/common/editor/controller/assistance/internal/local-assistance-beat-acceptance.ts';
import { createLocalAssistanceGuidedCleanupAcceptance } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-cleanup-acceptance.ts';
import { createLocalAssistanceTranscriptCleanupSession } from '../src/common/editor/controller/assistance/internal/local-assistance-cleanup-acceptance.ts';
import { localAssistanceSourceFrameToTimelineFrame, normalizeLocalAssistanceAudioAcceptanceAuthority } from '../src/common/editor/controller/assistance/internal/local-assistance-audio-acceptance-authority.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import { MixedRateAssistanceFixture, assistanceClaim, assistanceModel, DIGEST } from './helpers/local-assistance-mixed-rate-fixture.ts';
import { TranscriptStore } from './helpers/local-assistance-transcript-store.ts';

const RATES = [[44_100, 48_000], [48_000, 44_100], [96_000, 48_000]] as const;
const REVIEW = { kind: 'transcript' as const, language: 'en', segments: [{
	startSeconds: 0.25, endSeconds: 1.75, text: 'hello um there', speaker: null,
	words: [{ text: 'hello', startSeconds: 0.25, endSeconds: 0.5, confidence: 0.99 },
		{ text: 'um', startSeconds: 0.5, endSeconds: 0.75, confidence: 0.99 },
		{ text: 'there', startSeconds: 0.75, endSeconds: 1.75, confidence: 0.99 }],
}] };

for (const [sourceRate, projectRate] of RATES) {
	for (const operation of ['speech-recognition', 'speaker-diarization'] as const) {
		test(`${operation} publishes native transcript frames and project labels at ${sourceRate}/${projectRate}`, async () => {
			const fixture = new MixedRateAssistanceFixture(sourceRate, projectRate);
			const original = projectForCommand(fixture.history.present);
			const store = new TranscriptStore();
			const acceptance = createLocalAssistanceTranscriptAcceptance({ ...fixture.dependencies(), store });
			await acceptance.acceptValidatedResult({ sourceId: 'voice-source', operation,
				selectionFence: fixture.currentAuthority().fence,
				models: operation === 'speech-recognition'
					? [assistanceModel('speech-recognition', 'parakeet-tdt-0.6b-v3')]
					: [assistanceModel('speaker-segmentation', 'pyannote-segmentation-3.0'),
						assistanceModel('speaker-embedding', 'speech-3d-speaker-eres2net', '1.0.0', 'cd'.repeat(32))],
				outputs: [{ claim: assistanceClaim('transcript'), review: REVIEW }],
			});
			assert.deepEqual(fixture.labels('Transcript'), [{ title: 'hello um there',
				startFrame: projectRate * 1.75, endFrame: projectRate * 3.25 }]);
			const body = JSON.parse(await [...store.bodies.values()][0]!.text()) as {
				sampleRate: number; segments: Array<{ startFrame: number; endFrame: number }>;
			};
			assert.equal(body.sampleRate, sourceRate);
			assert.equal(body.segments[0]!.startFrame, sourceRate * 1.25);
			assert.equal(body.segments[0]!.endFrame, sourceRate * 2.75);
			assert.equal(fixture.commits, 1);
			fixture.undo();
			assert.deepEqual({ ...projectForCommand(fixture.history.present), revision: original.revision }, original);
		});
	}

	for (const operation of ['voice-activity-detection', 'speaker-diarization'] as const) {
		test(`${operation} places reviewed ranges in the project clock at ${sourceRate}/${projectRate}`, async () => {
			const fixture = new MixedRateAssistanceFixture(sourceRate, projectRate);
			const acceptance = createLocalAssistanceRangeLabelAcceptance(fixture.dependencies());
			await acceptance.acceptValidatedResult({ sourceId: 'voice-source', operation,
				selectionFence: fixture.currentAuthority().fence,
				models: operation === 'voice-activity-detection'
					? [assistanceModel(operation, 'silero-vad-v6')]
					: [assistanceModel('speaker-segmentation', 'pyannote-segmentation-3.0'),
						assistanceModel('speaker-embedding', 'speech-3d-speaker-eres2net', '1.0.0', 'cd'.repeat(32))],
				outputs: [{ claim: assistanceClaim(operation === 'voice-activity-detection' ? 'voice-activity' : 'speaker-turns'),
					review: operation === 'voice-activity-detection'
						? { kind: 'voice-activity', sampleRate: 16_000, segments: [{ startSample: 4_000, sampleCount: 16_000 }] }
						: { kind: 'speaker-turns', sampleRate: 16_000, turns: [{ speakerId: 0, startSample: 4_000, sampleCount: 8_000 }] } }],
			});
			assert.deepEqual(fixture.labels(operation === 'voice-activity-detection' ? 'Silences' : 'Speakers'),
				operation === 'voice-activity-detection'
					? [{ title: 'Silence', startFrame: projectRate * 1.5, endFrame: projectRate * 1.75 },
						{ title: 'Silence', startFrame: projectRate * 2.75, endFrame: projectRate * 3.5 }]
					: [{ title: 'Speaker 1', startFrame: projectRate * 1.75, endFrame: projectRate * 2.25 }]);
			assert.equal(fixture.commits, 1);
			fixture.undo();
			assert.equal(fixture.history.present.tracks.length, 1);
		});
	}

	test(`reactions and late beat points use the rendered duration at ${sourceRate}/${projectRate}`, async () => {
		const reactionFixture = new MixedRateAssistanceFixture(sourceRate, projectRate);
		const reaction = createLocalAssistanceReactionReviewSession(reactionFixture.dependencies(), {
			sourceId: 'voice-source', operation: 'audio-tagging', selectionFence: reactionFixture.currentAuthority().fence,
			models: [assistanceModel('audio-tagging', 'panns-cnn10')], outputs: [{ claim: assistanceClaim('audio-tags'),
				review: { kind: 'audio-tags', schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
					windows: [{ startSample: 32_000, scores: { laughter: 0.9, applause: 0, cheering: 0 } }] } }],
		});
		await reaction.accept(reaction.snapshot().proposals.map(({ id }) => id));
		assert.deepEqual(reactionFixture.labels('Reactions'), [{ title: 'Laughter',
			startFrame: projectRate * 2.5, endFrame: projectRate * 3.5 }]);
		const beatFixture = new MixedRateAssistanceFixture(sourceRate, projectRate);
		const beats = createLocalAssistanceBeatReviewSession(beatFixture.dependencies(), {
			sourceId: 'voice-source', operation: 'beat-tracking', selectionFence: beatFixture.currentAuthority().fence,
			models: [assistanceModel('beat-tracking', 'beat-this-small0', '1.1.0')],
			outputs: [{ claim: assistanceClaim('beat-grid'), review: { kind: 'beat-grid', schemaVersion: 1,
				sampleRate: 22_050, points: [{ sample: 41_895, kind: 'beat', confidence: 0.9 }], tempoProposal: null } }],
		});
		await beats.accept(beats.snapshot().proposals.map(({ id }) => id));
		assert.equal(beatFixture.labels('Beats')[0]?.startFrame, projectRate * 3.4);
		beatFixture.undo();
		assert.equal(beatFixture.history.present.tracks.length, 1);
	});

	for (const guided of [false, true]) test(`${guided ? 'guided' : 'legacy'} cleanup deletes the exact project interval at ${sourceRate}/${projectRate}`, async () => {
		const fixture = new MixedRateAssistanceFixture(sourceRate, projectRate);
		const original = projectForCommand(fixture.history.present);
		if (guided) {
			await createLocalAssistanceGuidedCleanupAcceptance(fixture.dependencies()).accept({
				selectionFence: fixture.currentAuthority().fence, selectedProposalIds: ['filler'],
				result: { schemaVersion: 1, kind: 'cleanup-proposals', preset: 'balanced', proposals: [{
					id: 'filler', kind: 'filler', startFrame: sourceRate * 1.5, endFrame: sourceRate * 1.75,
					text: 'um', selected: false,
				}] },
			});
		} else {
			const cleanup = createLocalAssistanceTranscriptCleanupSession(fixture.dependencies(), {
				selectionFence: fixture.currentAuthority().fence, review: REVIEW,
				models: [assistanceModel('speech-recognition', 'parakeet-tdt-0.6b-v3')],
				preset: 'balanced', options: { fillerLexicon: ['um'] }, voiceActivity: null,
			});
			assert.deepEqual(cleanup.snapshot().proposals.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })),
				[{ startFrame: projectRate * 2, endFrame: projectRate * 2.25 }]);
			await cleanup.accept(cleanup.snapshot().proposals.map(({ id }) => id));
		}
		assert.equal(fixture.commits, 1);
		assert.deepEqual(fixture.history.present.clips.filter(clip => clip.kind === 'audio').map(clip => ({
			start: clip.timelineStartFrame, duration: clip.durationFrames, sourceStart: clip.sourceStartFrame,
		})), [{ start: projectRate, duration: projectRate, sourceStart: sourceRate / 2 },
			{ start: projectRate * 2, duration: projectRate * 2.75, sourceStart: sourceRate * 1.75 }]);
		fixture.undo();
		assert.deepEqual({ ...projectForCommand(fixture.history.present), revision: original.revision }, original);
	});
}

test('mixed-rate authority rejects altered source rates, selection extents, and source identity', () => {
	const fixture = new MixedRateAssistanceFixture();
	const authority = fixture.currentAuthority();
	for (const altered of [
		{ ...authority, source: { ...authority.source, sampleRate: 96_000 } },
		{ ...authority, sourceEndFrame: authority.sourceEndFrame + 1_000 },
		{ ...authority, source: { ...authority.source, contentSha256: 'cd'.repeat(32) } },
		{ ...authority, project: { ...authority.project, sources: [] } },
		{ ...authority, project: { ...authority.project, sources: [authority.source, authority.source] } },
		{ ...authority, clip: { ...authority.clip, sourceStartFrame: 0 } },
	]) assert.throws(() => normalizeLocalAssistanceAudioAcceptanceAuthority(altered, 'Missing authority'));
	assert.equal(authority.fence.sourceSha256, DIGEST);
});

test('native rounding retains the exact selected project endpoints for trimmed occurrences', () => {
	const authority = new MixedRateAssistanceFixture().currentAuthority();
	const normalized = normalizeLocalAssistanceAudioAcceptanceAuthority({ ...authority,
		startFrame: 72_001, endFrame: 168_003, sourceStartFrame: 44_101, sourceEndFrame: 132_303,
		fence: { ...authority.fence, sourceStartFrame: 44_101, sourceEndFrame: 132_303 },
	}, 'Missing authority');
	assert.equal(localAssistanceSourceFrameToTimelineFrame(44_101, normalized), 72_001);
	assert.equal(localAssistanceSourceFrameToTimelineFrame(132_303, normalized), 168_003);
	assert.equal(localAssistanceSourceFrameToTimelineFrame(88_201, normalized), 120_001);
	assert.throws(() => localAssistanceSourceFrameToTimelineFrame(132_304, normalized), RangeError);
});
