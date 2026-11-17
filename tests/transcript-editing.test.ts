/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	projectTranscriptWords, transcriptTextSelection, transcriptAudioSelection, transcriptGenerationTargets,
	transcriptEditingGeometryKey,
	type TranscriptEditingBody,
} from '../src/common/editor/transcript-editing.ts';

const body: TranscriptEditingBody = { assetId: 'transcript-a', transcript: {
	schemaVersion: 1, sourceId: 'source-a', sampleRate: 1_000, language: 'en', modelId: 'parakeet',
	segments: [{ startFrame: 0, endFrame: 3_000, text: 'One two three.', speaker: null, words: [
		{ text: 'One', startFrame: 0, endFrame: 800, confidence: null },
		{ text: 'two', startFrame: 1_000, endFrame: 1_800, confidence: null },
		{ text: 'three.', startFrame: 2_000, endFrame: 2_800, confidence: null },
	] }],
} };

function project(clips = [{ id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 1_000,
	durationFrames: 3_000, sourceStartFrame: 0, sourceDurationFrames: 3_000 }]) {
	return { id: 'project-a', revision: 0, schemaVersion: 2, sampleRate: 1_000, clips,
		sources: [{ id: 'source-a', sampleRate: 1_000, frameCount: 3_000 }],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: clips.map(clip => clip.id) }] };
}

test('transcript words follow the current clip occurrence and source clock', () => {
	const words = projectTranscriptWords(project(), [body]);
	assert.deepEqual(words.map(word => [word.text, word.startFrame, word.endFrame]), [
		['One', 1_000, 1_800], ['two', 2_000, 2_800], ['three.', 3_000, 3_800],
	]);
	assert.equal(new Set(words.map(word => word.id)).size, 3);
});

test('selection revisions retain the transcript view while media, layout, and lock changes invalidate it', () => {
	const p = project(), key = transcriptEditingGeometryKey(p);
	assert.equal(transcriptEditingGeometryKey({ ...p, revision: 2,
		selection: { startFrame: 1_000, endFrame: 2_000 } }), key);
	assert.notEqual(transcriptEditingGeometryKey({ ...p, clips: [{ ...p.clips[0], timelineStartFrame: 2_000 }] }), key);
	assert.notEqual(transcriptEditingGeometryKey({ ...p, sources: [{ ...p.sources[0], contentSha256: 'new-source' }] }), key);
	assert.notEqual(transcriptEditingGeometryKey({ ...p, tracks: [{ ...p.tracks[0], locked: true }] }), key);
});

test('split and ripple-deleted audio projects only surviving words without mutating source text', () => {
	const clips = [
		{ id: 'left', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 1_000,
			durationFrames: 1_000, sourceStartFrame: 0, sourceDurationFrames: 1_000 },
		{ id: 'right', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 2_000,
			durationFrames: 1_000, sourceStartFrame: 2_000, sourceDurationFrames: 1_000 },
	];
	assert.deepEqual(projectTranscriptWords(project(clips), [body]).map(word => [word.text, word.startFrame]),
		[['One', 1_000], ['three.', 2_000]]);
	assert.equal(body.transcript.segments[0]!.words.length, 3);
});

test('duplicated occurrences have separate identities and no duplicate overlapping transcript bodies', () => {
	const original = project();
	const duplicate = { ...original.clips[0]!, id: 'copy', timelineStartFrame: 5_000 };
	const words = projectTranscriptWords(project([...original.clips, duplicate]), [body, body]);
	assert.equal(words.length, 6);
	assert.equal(new Set(words.map(word => word.id)).size, 6);
});

test('a newer partial transcript replaces only its covered words in an older full-source transcript', () => {
	const replacement: TranscriptEditingBody = { assetId: 'new-transcript', transcript: { ...body.transcript,
		segments: [{ ...body.transcript.segments[0]!, startFrame: 1_000, endFrame: 1_800, text: 'TWO',
			words: [{ ...body.transcript.segments[0]!.words[1]!, text: 'TWO' }] }] } };
	assert.deepEqual(projectTranscriptWords(project(), [replacement, body]).map(word => word.text), ['One', 'TWO', 'three.']);
});

test('long transcripts project without scanning prior segment ranges for every word', t => {
	const original = Array.prototype.some;
	const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'some')!;
	t.after(() => { Object.defineProperty(Array.prototype, 'some', descriptor); });
	Object.defineProperty(Array.prototype, 'some', { ...descriptor, value: function (this: unknown[],
		predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown,
	): boolean {
		const first = this[0];
		if (first && typeof first === 'object' && 'start' in first && 'end' in first) {
			assert.ok(this.length < 32, 'projected words should avoid linear scans of accumulated coverage');
		}
		return original.call(this, predicate, thisArg);
	} });

	const segments = Array.from({ length: 700 }, (_, index) => ({
		startFrame: index * 4, endFrame: index * 4 + 2, text: String(index), speaker: null, words: [],
	}));
	const older = { assetId: 'older', transcript: { ...body.transcript, segments } };
	const newer = { assetId: 'newer', transcript: { ...body.transcript, segments: [
		{ startFrame: 400, endFrame: 502, text: 'replaced', speaker: null, words: [] },
	] } };
	const latest = { assetId: 'latest', transcript: { ...body.transcript, segments: [
		{ startFrame: 480, endFrame: 562, text: 'latest', speaker: null, words: [] },
	] } };
	assert.deepEqual(projectTranscriptWords(project(), [older]).map(word => word.text), segments.map(segment => segment.text));
	assert.deepEqual(projectTranscriptWords(project(), [latest, newer, older]).map(word => word.text),
		[...segments.slice(0, 100).map(segment => segment.text), 'latest', ...segments.slice(141).map(segment => segment.text)]);
});

test('text selection encloses complete words and maps back from audio without selecting other tracks', () => {
	const words = projectTranscriptWords(project(), [body]);
	assert.deepEqual(transcriptTextSelection(words.slice(0, 2)), {
		startFrame: 1_000, endFrame: 2_800, trackIds: ['track-a'], clipIds: ['clip-a'],
	});
	assert.deepEqual(transcriptAudioSelection(words, { startFrame: 2_100, endFrame: 2_700,
		trackIds: ['track-a'], clipIds: [] }).map(word => word.text), ['two']);
	assert.deepEqual(transcriptAudioSelection(words, { startFrame: 2_100, endFrame: 2_700,
		trackIds: ['other'], clipIds: [] }), []);
});

test('unaligned zero-duration Whisper words fall back to one selectable segment', () => {
	const unaligned: TranscriptEditingBody = { ...body, transcript: { ...body.transcript,
		segments: [{ ...body.transcript.segments[0]!, words: [{ text: 'One', startFrame: 0,
			endFrame: 0, confidence: null }] }] } };
	const words = projectTranscriptWords(project(), [unaligned]);
	assert.equal(words.length, 1);
	assert.equal(words[0]!.granularity, 'segment');
	assert.deepEqual([words[0]!.startFrame, words[0]!.endFrame], [1_000, 4_000]);
});

test('source-rate conversion and scalar retiming preserve the occurrence duration', () => {
	const p = project([{ id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 100,
		durationFrames: 1_500, sourceStartFrame: 0, sourceDurationFrames: 3_000 }]);
	const words = projectTranscriptWords(p, [body]);
	assert.deepEqual(words.map(word => [word.startFrame, word.endFrame]),
		[[100, 500], [600, 1_000], [1_100, 1_500]]);
	const differentClock = { ...p, sampleRate: 2_000, clips: [{ ...p.clips[0]!, durationFrames: 6_000 }] };
	assert.deepEqual(projectTranscriptWords(differentClock, [body]).map(word => [word.startFrame, word.endFrame]),
		[[100, 1_700], [2_100, 3_700], [4_100, 5_700]]);
});

test('word boundaries use the exact inverse of a forward audio warp', () => {
	const p = project();
	const warped = { ...p, clips: [{ ...p.clips[0]!, durationFrames: 4_000, warpMap: {
		feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 2_000, source: 1_000, mode: 'forward' },
			{ outer: 4_000, source: 3_000, mode: 'forward' },
		],
	} }] };
	assert.deepEqual(projectTranscriptWords(warped, [body]).map(word => [word.startFrame, word.endFrame]),
		[[1_000, 2_600], [3_000, 3_800], [4_000, 4_800]]);
});

test('loop iterations and reversed playback map into distinct audible word spans', () => {
	const p = project();
	const loop = { ...p, clips: [{ ...p.clips[0]!, durationFrames: 6_000,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 3_000, offsetFrames: 0 } } }] };
	assert.deepEqual(projectTranscriptWords(loop, [body]).map(word => [word.text, word.startFrame]), [
		['One', 1_000], ['two', 2_000], ['three.', 3_000], ['One', 4_000], ['two', 5_000], ['three.', 6_000],
	]);
	const reversed = { ...p, clips: [{ ...p.clips[0]!, reversed: true }] };
	assert.deepEqual(projectTranscriptWords(reversed, [body]).map(word => [word.text, word.startFrame, word.endFrame]), [
		['three.', 1_200, 2_000], ['two', 2_200, 3_000], ['One', 3_200, 4_000],
	]);
});

test('generation includes muted and hidden audio while excluding locked tracks and missing sources', () => {
	const p = project();
	assert.equal(transcriptGenerationTargets({ ...p, tracks: [{ ...p.tracks[0], mute: true, hidden: true }] }).length, 1);
	assert.equal(transcriptGenerationTargets({ ...p, tracks: [{ ...p.tracks[0], locked: true }] }).length, 0);
	assert.equal(transcriptGenerationTargets(p, new Set(['source-a'])).length, 0);
	assert.equal(transcriptGenerationTargets({ ...p, sources: [{ ...p.sources[0], kind: 'midi' }] }).length, 0);
});

test('transcript targets index track membership while preserving clip document order', () => {
	const clips = Array.from({ length: 64 }, (_, index) => ({ ...project().clips[0]!, id: `clip-${index}`, timelineStartFrame: index * 3_000 }));
	const p = project(clips);
	const clipIds = ['clip-55', 'clip-2', 'clip-55'];
	Object.defineProperty(clipIds, 'includes', { value: () => assert.fail('clip membership must not scan the track for every clip') });
	assert.deepEqual(transcriptGenerationTargets({ ...p, tracks: [{ ...p.tracks[0], clipIds }] }).map(target => target.clipId),
		['clip-2', 'clip-55']);
});
