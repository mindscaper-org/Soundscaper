/* SPDX-License-Identifier: AGPL-3.0-only */
import { BASIC_PITCH_MODEL_ID, BASIC_PITCH_MODEL_VERSION, BASIC_PITCH_MODEL_SHA256 } from '../../../assistance/basic-pitch-model.ts';
import { musicTranscriptionMidiDocument, reviewMusicTranscriptionV1, type MusicMidiImporter } from '../../../assistance/music-transcription-v1.ts';
import { validateAssistanceSelectionFence, AssistanceProposalStaleError } from '../../../assistance/proposal-session.ts';
import type { LocalAssistanceValidatedResultAcceptanceRequest } from '../../../assistance/local-assistance-preparation.ts';
import { normalizeLocalAssistanceAudioAcceptanceAuthority } from './local-assistance-audio-acceptance-authority.ts';
import { scaleSampleFrame } from '../../../timeline-time.ts';

interface Dependencies {
	readonly currentAuthority: () => unknown;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly importMidiDocument?: MusicMidiImporter;
}

/** Publish through the single owning MIDI queue, after re-admitting the selected occurrence and note body. */
export async function acceptMusicTranscription(dependencies: Dependencies, value: unknown): Promise<void> {
	if (!dependencies.importMidiDocument) throw new Error('MIDI transcription publication is unavailable.');
	const request = value as Partial<LocalAssistanceValidatedResultAcceptanceRequest> | null;
	if (!request || request.operation !== 'music-transcription') throw new TypeError('Expected a music transcription result.');
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	const authority = normalizeLocalAssistanceAudioAcceptanceAuthority(dependencies.currentAuthority(), 'Music transcription requires selected audio.');
	if (fence.schemaFamily !== 'soundscaper' || request.sourceId !== fence.sourceId
		|| JSON.stringify(fence) !== JSON.stringify(authority.fence)) throw new AssistanceProposalStaleError();
	const model = request.models?.[0];
	if (request.models?.length !== 1 || model?.modelId !== BASIC_PITCH_MODEL_ID || model.version !== BASIC_PITCH_MODEL_VERSION
		|| model.task !== 'music-transcription' || JSON.stringify(model.artifactSha256s) !== JSON.stringify([BASIC_PITCH_MODEL_SHA256])) throw new TypeError('The music transcription model identity changed.');
	const output = request.outputs?.[0], claim = output?.claim;
	if (request.outputs?.length !== 1 || claim?.claimVersion !== 1 || claim.role !== 'midi-notes'
		|| !['application/json', 'application/vnd.soundscaper.midi-notes+json'].includes(claim.mediaType)
		|| !/^[a-f\d]{40}$/u.test(claim.claimId) || !/^[a-f\d]{40}$/u.test(claim.jobId)
		|| !/^[a-f\d]{64}$/u.test(claim.sha256) || !Number.isSafeInteger(claim.byteLength)
		|| claim.byteLength < 1 || claim.byteLength > 8 * 1024 ** 2 || output?.review.kind !== 'midi-notes') throw new TypeError('Music transcription requires one authenticated MIDI note output.');
	const { kind: _kind, ...body } = output.review;
	const result = reviewMusicTranscriptionV1(body);
	const durationFrames = authority.timelineEndFrame - authority.timelineStartFrame;
	if (result.sampleCount !== Number(scaleSampleFrame(durationFrames, authority.sampleRate, result.sampleRate, 'point'))) throw new RangeError('Music transcription no longer matches the selected duration.');
	if (!result.notes.length) throw new RangeError('No notes were detected in this selection.');
	const document = musicTranscriptionMidiDocument(result, authority.sampleRate, 'Basic Pitch');
	const track = document.tracks[0]!;
	const provenance = new TextEncoder().encode(JSON.stringify({ soundscaperMusicTranscription: 1,
		modelId: model.modelId, modelVersion: model.version, modelSha256: BASIC_PITCH_MODEL_SHA256,
		resultSha256: claim.sha256, sourceSha256: fence.sourceSha256 }));
	const token = dependencies.captureProject();
	dependencies.assertProject(token);
	await dependencies.importMidiDocument({ ...document, tracks: [{ ...track, durationFrames,
		events: [{ frame: 0, status: 255, metaType: 1, data: [...provenance] }],
		notes: track.notes.map(note => {
			if (note.startFrame >= durationFrames) throw new RangeError('A transcribed note starts outside the selection.');
			return { ...note, durationFrames: Math.min(note.durationFrames, durationFrames - note.startFrame) };
		}) }] }, { timelineStartFrame: authority.timelineStartFrame });
}
