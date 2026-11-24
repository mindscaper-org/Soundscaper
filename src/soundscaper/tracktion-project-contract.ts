/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionAudioDeviceCommand, TracktionAudioDeviceReply } from './tracktion-audio-device-contract.ts';
import type { TracktionEffectCommand, TracktionEffectInstallation, TracktionEffectPage } from './tracktion-effect-contract.ts';

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

export interface TracktionProjectPage {
	readonly revision: number;
	readonly sampleRate: number;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
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
	readonly initiallyUnsaved?: boolean;
}

export interface TracktionTransportView {
	readonly ready: boolean;
	readonly playing: boolean;
	readonly recording: boolean;
	readonly frame: number;
	readonly outputInterrupted?: true;
	readonly interruptedTake?: TracktionEditResult;
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

type Session = Readonly<{ sessionId: string }>;
type Edit = Session & Readonly<{ revision: number }>;

export type TracktionProjectCommand =
	| Readonly<{ kind: 'create'; sampleRate: number }>
	| Readonly<{ kind: 'open' }>
	| (Session & Readonly<{ kind: 'project'; offset: number }>)
	| (Edit & Readonly<{ kind: 'clips'; trackId: string; offset: number }>)
	| (Edit & Readonly<{ kind: 'addTrack'; name: string }>)
	| (Session & TracktionMixCommand)
	| (Edit & Readonly<{ kind: 'import'; trackId: string; start: number }>)
	| (Edit & TracktionClipCommand)
	| (Edit & TracktionRangeCommand)
	| (Edit & TracktionPasteCommand)
	| (Edit & Readonly<{ kind: 'undo' | 'redo' | 'save' }>)
	| (Edit & Readonly<{ kind: 'render'; start: number; end: number }>)
	| (Edit & Readonly<{ kind: 'archive' }>)
	| (Session & TracktionAudioDeviceCommand)
	| (Session & TracktionEffectCommand)
	| (Session & TracktionTransportCommand)
	| (Session & TracktionRecordingCommand)
	| (Session & Readonly<{ kind: 'close' }>);

export type TracktionProjectReply<Command extends TracktionProjectCommand> =
	Command extends { kind: 'create' | 'open' } ? TracktionOpenedProject | null
		: Command extends { kind: 'project' } ? TracktionProjectPage
			: Command extends { kind: 'clips' } ? TracktionClipPage
				: Command extends { kind: 'offlineEffects' } ? TracktionEffectPage
					: Command extends { kind: 'offlineEffectCatalog' | 'scanOfflineEffects' } ? readonly TracktionEffectInstallation[] | null
				: Command extends { kind: 'trackMix' } ? TracktionTrackMix
					: Command extends TracktionAudioDeviceCommand ? TracktionAudioDeviceReply<Command>
						: Command extends { kind: 'import' | 'render' | 'archive' } ? TracktionEditResult | null
							: Command extends TracktionTransportCommand | { kind: 'startRecording' } ? TracktionTransportView
								: Command extends { kind: 'close' } ? null : TracktionEditResult;

export interface TracktionProjectBridge {
	request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>>;
	onRecordingInterrupted?(listener: () => void): () => void;
	openArchive?(): Promise<TracktionOpenedProject | null>;
}
