/* SPDX-License-Identifier: AGPL-3.0-only */
import type { TranscriptEditingDocument } from '../../controller/composition/transcript-editing-actions.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../../assistance/local-assistance-preparation.ts';
import type { TranscriptAudioSelection } from '../../transcript-editing.ts';

export interface TranscriptPanelController {
	readonly selectedMediaPreparation?: LocalAssistanceSelectedMediaPreparationPort | null;
	getSnapshot(): { readonly project: { readonly id: string; readonly revision: number; readonly selection?: TranscriptAudioSelection } | null };
	readonly actions: {
		readonly transcript: {
			read(projectId: string): Promise<TranscriptEditingDocument>;
			remove(projectId: string, revision: number, wordIds: readonly string[]): Promise<void>;
		};
		readonly timeline: {
			selectClip(clipId: string): unknown;
			setExactSelection(start: number, end: number, details: { trackIds: readonly string[]; clipIds: readonly string[]; frequencyRange: null }): unknown;
		};
		readonly transport: { seek(frame: number): unknown };
		readonly edit: { undo(): unknown; redo(): unknown };
	};
}

export interface TranscriptPanelSnapshot {
	readonly project: { readonly id: string; readonly revision: number; readonly sampleRate: number;
		readonly selection?: TranscriptAudioSelection } | null;
	readonly readOnly?: boolean;
	readonly timeline?: { readonly pixelsPerSecond?: number };
}
