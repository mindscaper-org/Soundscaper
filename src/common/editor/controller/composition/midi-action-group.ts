/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EditorActionRuntime } from './action-facade-runtime.ts';
import type { MidiService } from '../track-audio/midi-service-types.ts';
import type { MidiInstrument, MidiNote } from '../../midi-model.ts';
import type { MidiClipResize, MidiNoteUpdate } from '../track-audio/midi-service-types.ts';
import { createMidiImportFiles } from './internal/midi-import-files.ts';
import { resolveMidiCopy } from '../../../i18n/editor-midi-copy.ts';

/** Keep the beta synthesizer and file codecs outside the initial editor graph. */
export function createMidiActionGroup(scope: EditorActionRuntime) {
	let loaded: Promise<Readonly<MidiService>> | null = null;
	const service = () => loaded ??= import('../track-audio/midi-service.ts').then(({ createMidiService }) => createMidiService({
		getProject: scope.getProject,
		editingBlocked: () => Boolean(scope.state.phase === 'disposed' || scope.state.phase === 'disposing' || scope.state.readOnly || scope.state.projectActivationPending || scope.state.recorder || scope.state.recordingStarting || scope.state.projectAdministrationPending),
		commit: scope.commit,
		createId: scope.createStableId,
		trackName: () => resolveMidiCopy(scope.copy).track,
		clipName: () => resolveMidiCopy(scope.copy).clip,
		store: scope.store,
		previewNote: async (pitch, instrument) => {
			const { previewMidiNote } = await import('../track-audio/midi-preview.ts');
			await previewMidiNote(scope.engine, pitch, instrument);
		},
		saveFile: request => scope.fileService.saveFile(request),
	}));
	const actions = Object.freeze({
		addTrack: async () => (await service()).addTrack(),
		addNote: async (clipId: string, note: MidiNote) => (await service()).addNote(clipId, note),
		updateNote: async (clipId: string, id: string, changes: Partial<MidiNote>) => (await service()).updateNote(clipId, id, changes),
		updateNotes: async (clipId: string, updates: readonly MidiNoteUpdate[]) => (await service()).updateNotes(clipId, updates),
		deleteNotes: async (clipId: string, ids: readonly string[]) => (await service()).deleteNotes(clipId, ids),
		resizeClip: async (clipId: string, changes: MidiClipResize) => (await service()).resizeClip(clipId, changes),
		setInstrument: async (trackId: string, instrument: MidiInstrument) => (await service()).setInstrument(trackId, instrument),
		previewNote: async (pitch: number, instrument?: MidiInstrument) => (await service()).previewNote(pitch, instrument),
		exportFile: async (format: 'midi' | 'allegro') => (await service()).exportFile(format),
	});
	return Object.freeze({ actions, importFiles: createMidiImportFiles(scope, service) });
}
