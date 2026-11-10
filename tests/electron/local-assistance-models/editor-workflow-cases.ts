/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceWorkflowId } from '../../../src/common/editor/assistance/workflow.ts';

export interface EditorWorkflowCase {
	readonly modelIds: readonly string[];
	readonly video?: boolean;
	readonly transcript?: boolean;
	readonly fixture?: 'rhythm' | 'mixed-speech' | 'short-mono' | 'short-stereo';
	readonly externalFfmpeg?: boolean;
	readonly visualIndex?: boolean;
}

const VAD = 'silero-vad-v6';
const ASR = 'parakeet-tdt-0.6b-v3';
const DIARIZATION = ['pyannote-segmentation-3.0', 'speech-3d-speaker-eres2net'];
const SUBJECTS = ['yunet-face-detection-2026may', 'dfine-nano-coco'];
const QWEN = 'qwen3-4b-q4-k-m';

/** Exhaustive recipes: adding a menu workflow requires deciding how nightly exercises it. */
export const EDITOR_WORKFLOW_CASES = {
	'transcribe-captions': { modelIds: [VAD, ASR] },
	'clean-filler-silence': { modelIds: [VAD, ASR] },
	'identify-speakers': { modelIds: DIARIZATION, transcript: true },
	'enhance-dialogue': { modelIds: ['deepfilternet3'], fixture: 'mixed-speech' },
	'reduce-reverb': { modelIds: ['dereverb-room'], fixture: 'short-mono' },
	'separate-dialogue-music-effects': { modelIds: ['tiger-dnr'], fixture: 'mixed-speech' },
	'mark-reactions': { modelIds: ['panns-cnn10'] },
	'detect-beats-tempo': { modelIds: ['beat-this-small0'], fixture: 'rhythm' },
	'mark-cuts': { modelIds: ['transnetv2'], video: true },
	'index-transcript': { modelIds: ['nomic-embed-text-v1.5'], transcript: true },
	'index-video': { modelIds: ['transnetv2', 'siglip2-base-patch16-224', 'ppocr-v4-mobile'], video: true },
	'reframe': { modelIds: [...SUBJECTS, 'u2netp-saliency'], video: true },
	'make-highlights': { modelIds: [QWEN], video: true, externalFfmpeg: true, visualIndex: true },
	'generate-editorial-text': { modelIds: [QWEN], transcript: true },
	'advanced:voice-activity-detection': { modelIds: [VAD] },
	'advanced:speech-recognition': { modelIds: [ASR] },
	'advanced:word-alignment': { modelIds: ['wav2vec2-base-960h'], transcript: true },
	'advanced:speaker-diarization': { modelIds: DIARIZATION },
	'advanced:speech-enhancement': { modelIds: ['deepfilternet3'] },
	'advanced:dereverberation': { modelIds: ['dereverb-room'], fixture: 'short-stereo' },
	'advanced:source-separation': { modelIds: ['tiger-dnr'], fixture: 'mixed-speech' },
	'advanced:audio-tagging': { modelIds: ['panns-cnn10'] },
	'advanced:beat-tracking': { modelIds: ['beat-this-small0'], fixture: 'rhythm' },
	'advanced:text-embedding': { modelIds: ['nomic-embed-text-v1.5'], transcript: true },
	'advanced:image-text-embedding': { modelIds: ['siglip2-base-patch16-224'], video: true },
	'advanced:optical-character-recognition': { modelIds: ['ppocr-v4-mobile'], video: true },
	'advanced:shot-detection': { modelIds: ['transnetv2'], video: true },
	'advanced:subject-detection': { modelIds: SUBJECTS, video: true },
	'advanced:saliency-detection': { modelIds: ['u2netp-saliency'], video: true },
	'advanced:editorial-generation': { modelIds: [QWEN], transcript: true },
} as const satisfies Readonly<Record<AssistanceWorkflowId, EditorWorkflowCase>>;

export const EDITOR_TRANSCRIPT_MODEL_IDS = [VAD, ASR] as const;
