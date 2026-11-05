/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiInstrument, MidiNote } from '../../midi-model.ts';
import type { MidiFileDocument } from '../../midi-file-types.ts';
import type { ProjectChangedOptions } from '../document/project-mutation-service.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';

export interface MidiProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly revision: number;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly sources?: readonly Readonly<Record<string, unknown>>[];
	readonly tempo?: Readonly<{ bpm?: number; timeSignature?: Readonly<{ numerator?: number; denominator?: number }> }>;
}
export interface MidiSourceWriter {
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}
export interface MidiServiceDependencies {
	getProject(): MidiProject | null;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand, selection?: MidiTransferSelection, options?: ProjectChangedOptions): unknown;
	createId(prefix: string): string;
	readonly trackName: () => string;
	readonly clipName: () => string;
	readonly store: Readonly<{
		beginSourceWrite(id: string, metadata: Readonly<Record<string, unknown>>): Promise<MidiSourceWriter>;
		deleteSource(id: string): Promise<unknown>;
	}>;
	previewNote(pitch: number, instrument: MidiInstrument): Promise<void>;
	saveFile(request: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
}
export interface MidiCreatedTrack { readonly trackId: string; readonly clipId: string }
export interface MidiImportedClip { readonly trackId: string | null; readonly clipId: string }
export interface MidiNoteUpdate { readonly id: string; readonly changes: Partial<MidiNote> }
export interface MidiClipResize {
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly durationFrames: number;
}
export interface MidiTransferSnapshot {
	readonly clips: readonly Readonly<{ id: string; sourceId?: unknown; sourceDurationFrames?: unknown; opaqueExtensions?: unknown }>[];
	readonly tracks: readonly Readonly<{ clipIds?: readonly string[]; opaqueExtensions?: unknown }>[];
	readonly sources?: readonly Readonly<{ id: string; kind?: unknown; sampleRate?: unknown; frameCount?: unknown }>[];
}
export interface MidiTransferSelection { readonly selectTrackId?: string | null; readonly selectClipId?: string | null }
export interface MidiService {
	/** Wait for MIDI work requested before this barrier, including source publication. */
	settled(): Promise<void>;
	commitTransfer(command: AudioEditorCommand, preview: (command: AudioEditorCommand) => MidiTransferSnapshot, selection?: MidiTransferSelection, options?: ProjectChangedOptions): Promise<unknown>;
	addTrack(): Promise<MidiCreatedTrack>;
	addNote(clipId: string, note: MidiNote): Promise<void>;
	updateNote(clipId: string, noteId: string, changes: Partial<MidiNote>): Promise<void>;
	updateNotes(clipId: string, updates: readonly MidiNoteUpdate[]): Promise<void>;
	deleteNotes(clipId: string, noteIds: readonly string[]): Promise<void>;
	resizeClip(clipId: string, changes: MidiClipResize): Promise<void>;
	setInstrument(trackId: string, instrument: MidiInstrument): Promise<void>;
	previewNote(pitch: number, instrument?: MidiInstrument): Promise<void>;
	importDocument(document: MidiFileDocument, options?: Readonly<{ timelineStartFrame?: number; destination?: 'timeline' | 'project-bin'; signal?: AbortSignal }>): Promise<readonly MidiImportedClip[]>;
	exportFile(format: 'midi' | 'allegro'): Promise<unknown>;
}
