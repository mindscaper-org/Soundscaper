/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiInstrument, MidiNote } from '../../midi-model.ts';
import type { MidiFileDocument } from '../../midi-file-types.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';

export interface MidiProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly revision: number;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
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
	commit(command: AudioEditorCommand, selection?: Readonly<{ selectTrackId?: string; selectClipId?: string }>): unknown;
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
export interface MidiNoteUpdate { readonly id: string; readonly changes: Partial<MidiNote> }
export interface MidiClipResize {
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly durationFrames: number;
}
export interface MidiService {
	addTrack(): Promise<MidiCreatedTrack>;
	addNote(clipId: string, note: MidiNote): Promise<void>;
	updateNote(clipId: string, noteId: string, changes: Partial<MidiNote>): Promise<void>;
	updateNotes(clipId: string, updates: readonly MidiNoteUpdate[]): Promise<void>;
	deleteNotes(clipId: string, noteIds: readonly string[]): Promise<void>;
	resizeClip(clipId: string, changes: MidiClipResize): Promise<void>;
	setInstrument(trackId: string, instrument: MidiInstrument): Promise<void>;
	previewNote(pitch: number, instrument?: MidiInstrument): Promise<void>;
	importDocument(document: MidiFileDocument, options?: Readonly<{ timelineStartFrame?: number; signal?: AbortSignal }>): Promise<readonly MidiCreatedTrack[]>;
	exportFile(format: 'midi' | 'allegro'): Promise<unknown>;
}
