/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionAudioDeviceCommand, TracktionAudioDeviceReply } from './tracktion-audio-device-contract.ts';
import type { TracktionAutomationCommand, TracktionAutomationPage } from './tracktion-automation-contract.ts';
import type { TracktionEffectCommand, TracktionEffectInstallation, TracktionEffectPage } from './tracktion-effect-contract.ts';

export const TRACKTION_TRACK_PAGE_SIZE = 64;
export const TRACKTION_CLIP_PAGE_SIZE = 64;
export const TRACKTION_RANGE_REMOVAL_REPLY_LIMIT = 256;
export const TRACKTION_PASTE_REPLY_LIMIT = 32;

export interface TracktionTrackView {
	readonly id: string;
	readonly name: string;
	readonly clipCount: number;
}

export interface TracktionClipView {
	readonly id: string;
	readonly name: string;
	readonly start: number;
	readonly end: number;
	readonly sourceOffset: number;
}

export interface TracktionIndexedClip {
	readonly clip: TracktionClipView;
	readonly index: number;
}

export interface TracktionEditHistory {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}

export interface TracktionProjectPage extends TracktionEditHistory {
	readonly revision: number;
	readonly sampleRate: number;
	readonly nextOffset: number | null;
	readonly tracks: readonly TracktionTrackView[];
}

export interface TracktionClipPage {
	readonly revision: number;
	readonly nextOffset: number | null;
	readonly clips: readonly TracktionClipView[];
}

export interface TracktionEditResult {
	readonly revision: number;
	readonly itemId: string | null;
	readonly history?: TracktionEditHistory;
	readonly timelineUnchanged?: true;
	readonly insertion?: Readonly<{ track: TracktionTrackView; index: number }>;
	readonly trimmedClip?: TracktionIndexedClip;
	readonly splitClips?: Readonly<{ left: TracktionIndexedClip; right: TracktionIndexedClip }>;
	readonly importedClip?: TracktionIndexedClip;
	readonly recordedClip?: TracktionIndexedClip;
	readonly placedClip?: TracktionIndexedClip;
	readonly removedClipIds?: readonly string[];
	readonly pastedClips?: readonly TracktionIndexedClip[];
}

export interface TracktionRecordingResult extends TracktionEditResult {
	readonly transport?: TracktionTransportObservation;
}

export interface TracktionAutomationPointResult extends TracktionEditResult {
	readonly itemId: null;
	readonly pointIndex: number;
}

export interface TracktionTrackMix {
	readonly gainDb: number;
	readonly pan: number;
	readonly muted: boolean;
	readonly solo: boolean;
}

export type TracktionMixCommand = Readonly<{ revision: number; trackId: string }> & (
	| Readonly<{ kind: 'trackMix' }>
	| (Readonly<{ kind: 'setTrackMix' }> & TracktionTrackMix)
);

export interface TracktionOpenedProject {
	readonly sessionId: string;
	readonly name: string;
	readonly project: TracktionProjectPage;
	readonly transport?: TracktionTransportObservation;
	readonly initiallyUnsaved?: boolean;
}

export interface TracktionTransportObservation {
	readonly playing: boolean;
	readonly recording: boolean;
	readonly frame: number;
	readonly outputInterrupted?: true;
	readonly interruptedTake?: TracktionEditResult;
}

export interface TracktionTransportView extends TracktionTransportObservation {
	readonly ready: boolean;
}

export type TracktionTransportCommand =
	| Readonly<{ kind: 'transportStatus' | 'prepareOutput' | 'stop' }>
	| Readonly<{ kind: 'play' | 'seek'; frame: number }>
	| Readonly<{ kind: 'setLoop'; enabled: boolean; start: number; end: number }>;

export type TracktionRecordingCommand =
	| Readonly<{ kind: 'startRecording'; revision: number; trackId: string; frame: number }>
	| Readonly<{ kind: 'finishRecording'; revision: number; discard: boolean }>;

export type TracktionClipCommand =
	| Readonly<{ kind: 'trim'; clipId: string; start: number; end: number }>
	| Readonly<{ kind: 'split'; clipId: string; frame: number }>
	| Readonly<{ kind: 'moveClip' | 'duplicateClip'; clipId: string; trackId: string; start: number }>
	| Readonly<{ kind: 'deleteClip'; clipId: string }>;

export type TracktionRangeCommand = Readonly<{ kind: 'deleteRange' | 'copyRange' | 'cutRange'; start: number; end: number }> & (
	| Readonly<{ mode: 'allTracks'; trackId: null }>
	| Readonly<{ mode: 'leaveGap' | 'perClip' | 'track'; trackId: string }>
);

export type TracktionPasteCommand = Readonly<{
	kind: 'pasteRange'; mode: 'overlap' | 'insertTracks' | 'insertAll'; trackId: string; start: number;
}>;

export type TracktionRenderCommand = Readonly<{ kind: 'render' }> & (
	| Readonly<{ start: number; end: number }>
	| Readonly<{ start?: never; end?: never }>
);

type Session = Readonly<{ sessionId: string }>;
type Edit = Session & Readonly<{ revision: number }>;

export type TracktionProjectCommand =
	| Readonly<{ kind: 'create'; sampleRate: number }>
	| Readonly<{ kind: 'open' }>
	| (Session & Readonly<{ kind: 'project'; offset: number }>)
	| (Edit & Readonly<{ kind: 'clips'; trackId: string; offset: number }>)
	| (Edit & Readonly<{ kind: 'addTrack'; name: string }>)
	| (Edit & Readonly<{ kind: 'duplicateTrack'; trackId: string }>)
	| (Session & TracktionMixCommand)
	| (Session & TracktionAutomationCommand)
	| (Edit & Readonly<{ kind: 'import'; trackId: string; start: number }>)
	| (Edit & TracktionClipCommand)
	| (Edit & TracktionRangeCommand)
	| (Edit & TracktionPasteCommand)
	| (Edit & Readonly<{ kind: 'undo' | 'redo' | 'save' }>)
	| (Edit & TracktionRenderCommand)
	| (Edit & Readonly<{ kind: 'archive' }>)
	| (Session & TracktionAudioDeviceCommand)
	| (Session & TracktionEffectCommand)
	| (Session & Readonly<{ kind: 'transportObservation' }>)
	| (Session & TracktionTransportCommand)
	| (Session & TracktionRecordingCommand)
	| (Session & Readonly<{ kind: 'close' }>);

export type TracktionProjectReply<Command extends TracktionProjectCommand> =
	Command extends { kind: 'create' | 'open' } ? TracktionOpenedProject | null
		: Command extends { kind: 'project' } ? TracktionProjectPage
			: Command extends { kind: 'trackAutomation' } ? TracktionAutomationPage
				: Command extends { kind: 'clips' } ? TracktionClipPage
				: Command extends { kind: 'offlineEffects' } ? TracktionEffectPage
					: Command extends { kind: 'offlineEffectCatalog' | 'scanOfflineEffects' } ? readonly TracktionEffectInstallation[] | null
				: Command extends { kind: 'trackMix' } ? TracktionTrackMix
					: Command extends TracktionAudioDeviceCommand ? TracktionAudioDeviceReply<Command>
						: Command extends { kind: 'import' | 'render' | 'archive' } ? TracktionEditResult | null
							: Command extends { kind: 'transportObservation' } ? TracktionTransportObservation
								: Command extends TracktionTransportCommand | { kind: 'startRecording' } ? TracktionTransportView
									: Command extends { kind: 'setAutomationPoint' } ? TracktionAutomationPointResult
										: Command extends { kind: 'finishRecording' } ? TracktionRecordingResult
											: Command extends { kind: 'close' } ? null : TracktionEditResult;

export interface TracktionProjectBridge {
	request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>>;
	onRecordingInterrupted?(listener: () => void): () => void;
	onProjectLost?(listener: (sessionId: string, message: string, clipboardRetained?: boolean) => void): () => void;
	openArchive?(): Promise<TracktionOpenedProject | null>;
}
