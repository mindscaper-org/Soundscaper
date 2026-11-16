/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptMusicTranscription } from '../src/common/editor/controller/assistance/internal/local-assistance-music-acceptance.ts';
import type { MidiFileDocument } from '../src/common/editor/midi-file-types.ts';
import { localAssistanceModelCompatible } from '../src/common/editor/controller/assistance/local-assistance-model-selection.ts';

function fixture() {
	const fence = { schemaFamily: 'soundscaper', schemaVersion: 1, projectId: 'project', revision: 4,
		sequenceId: 'main', occurrenceIds: ['clip'], sourceId: 'source', sourceSha256: 'ab'.repeat(32),
		sourceStartFrame: 24_000, sourceEndFrame: 72_000, linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32) };
	const request = { sourceId: 'source', operation: 'music-transcription', selectionFence: fence,
		models: [{ modelId: 'basic-pitch', version: '1.0.0', task: 'music-transcription', artifactSha256s: ['2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec'] }],
		outputs: [{ claim: { claimVersion: 1, claimId: 'a'.repeat(40), jobId: 'b'.repeat(40), role: 'midi-notes',
			mediaType: 'application/vnd.soundscaper.midi-notes+json', byteLength: 100, sha256: '12'.repeat(32) },
			review: { kind: 'midi-notes', schemaVersion: 1, sampleRate: 22_050, sampleCount: 22_050,
				notes: [{ pitch: 69, startSample: 2205, durationSamples: 11025, velocity: 96 }] } }],
	};
	const published: Array<{ document: MidiFileDocument; offset: number }> = [];
	const dependencies = { currentAuthority: () => ({ project: { id: 'project', schemaFamily: 'soundscaper', schemaVersion: 1,
		revision: 4, sampleRate: 48_000, tracks: [] }, fence, startFrame: 48_000, endFrame: 96_000,
		sourceStartFrame: 24_000, sourceEndFrame: 72_000 }),
		captureProject: () => 'token', assertProject: (token: unknown) => { assert.equal(token, 'token'); },
		importMidiDocument: async (document: MidiFileDocument, options: Readonly<{ timelineStartFrame: number }>) => { published.push({ document, offset: options.timelineStartFrame }); },
	};
	return { request, dependencies, published };
}

test('reviewed music is rescaled into the project clock and imported beside the selected occurrence', async () => {
	const { request, dependencies, published } = fixture();
	await acceptMusicTranscription(dependencies, request);
	assert.equal(published.length, 1);
	assert.equal(published[0]!.offset, 48_000);
	assert.equal(published[0]!.document.tracks[0]!.durationFrames, 48_000);
	const provenance = published[0]!.document.tracks[0]!.events?.[0];
	assert.equal(provenance?.metaType, 1);
	assert.match(new TextDecoder().decode(new Uint8Array(provenance!.data)), /"resultSha256":"1212/iu);
	assert.deepEqual(published[0]!.document.tracks[0]!.notes.map(({ pitch, startFrame, durationFrames, velocity }) => ({ pitch, startFrame, durationFrames, velocity })),
		[{ pitch: 69, startFrame: 4800, durationFrames: 24000, velocity: 96 }]);
});

test('stale source authority, changed model, mismatched geometry and empty results publish nothing', async () => {
	for (const mutate of [
		(value: ReturnType<typeof fixture>['request']) => { value.selectionFence.revision++; },
		(value: ReturnType<typeof fixture>['request']) => { value.models[0]!.artifactSha256s = ['f'.repeat(64)]; },
		(value: ReturnType<typeof fixture>['request']) => { value.outputs[0]!.review.sampleCount++; },
		(value: ReturnType<typeof fixture>['request']) => { value.outputs[0]!.review.notes = []; },
	]) {
		const { request, dependencies, published } = fixture();
		const changed = structuredClone(request); mutate(changed);
		await assert.rejects(() => acceptMusicTranscription(dependencies, changed));
		assert.equal(published.length, 0);
	}
});

test('Advanced music transcription offers only the pinned Basic Pitch model', () => {
	const model = fixture().request.models[0]!;
	assert.equal(localAssistanceModelCompatible('music-transcription', model), true);
	for (const replacement of [{ modelId: 'foreign' }, { version: '2.0.0' }, { artifactSha256s: ['f'.repeat(64)] }]) {
		assert.equal(localAssistanceModelCompatible('music-transcription', { ...model, ...replacement }), false);
	}
});
