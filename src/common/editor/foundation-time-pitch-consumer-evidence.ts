/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FoundationRuntimeConsumerEvidence } from './foundation-runtime-consumer-evidence.ts';

/** Scalar cache consumers use the same resolved beat clock as engine playback. */
export const FOUNDATION_TIME_PITCH_RUNTIME_CONSUMERS: readonly FoundationRuntimeConsumerEvidence[] = [
	{
		id: 'time-pitch-source-audition-musical-clock', surface: 'preview',
		file: 'src/common/editor/controller/clip-video/internal/clip-source-preview-project.ts', entryPoint: 'createClipSourcePreviewProject',
		inputIdentifier: 'playbackProject', projectedIdentifier: 'playbackClip', boundary: 'clipTimePitchPlaybackProjection',
		evidence: 'Source audition preserves the beat-derived scalar before detaching musical anchors, so its sample-anchored transient clip still selects the same committed cache as programme playback.',
	},
	{
		id: 'time-pitch-cache-musical-clock', surface: 'playback',
		file: 'src/common/editor/controller/source/clip-time-pitch-service.ts', entryPoint: 'projectTimePitchPairs',
		inputIdentifier: 'snapshot', projectedIdentifier: 'playbackClip', boundary: 'clipTimePitchPlaybackProjection',
		evidence: 'Playback and export cache admission resolve beat extent into the source-to-programme scalar before deciding whether independent time/pitch processing is required.',
	},
	{
		id: 'time-pitch-committed-render-musical-clock', surface: 'composition',
		file: 'src/common/editor/controller/clip-video/clip-time-pitch-render-service.ts', entryPoint: 'renderClipPitchSpeed',
		inputIdentifier: 'project', projectedIdentifier: 'playbackClip', boundary: 'clipTimePitchPlaybackProjection',
		evidence: 'Explicit Render Pitch and Speed bakes the effective beat-derived scalar while retaining the original canonical clip for ownership checks and replacement commands.',
	},
	{
		id: 'time-pitch-spectrogram-musical-clock', surface: 'waveform',
		file: 'src/common/editor/controller/source/internal/processed-spectrogram-pcm.ts', entryPoint: 'processedSpectrogramPreparation',
		inputIdentifier: 'project', projectedIdentifier: 'playbackClip', boundary: 'clipTimePitchPlaybackProjection',
		evidence: 'Processed spectrogram PCM acquires the same independent scalar cache as audible playback, including neutral authored speed with a tempo-shortened beat extent.',
	},
];
