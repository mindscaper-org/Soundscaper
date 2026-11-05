/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectChangedOptions } from '../document/project-mutation-service.ts';
import type { EditorActionRuntime } from './action-facade-runtime.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import { readMidiClip, readMidiTrack } from '../../midi-model.ts';
import type { MidiTransferSelection, MidiTransferSnapshot } from '../track-audio/midi-service-types.ts';
import type { MidiService } from '../track-audio/midi-service-types.ts';
import type { MidiInstrument, MidiNote } from '../../midi-model.ts';
import type { MidiClipResize, MidiNoteUpdate } from '../track-audio/midi-service-types.ts';
import { createMidiImportFiles } from './internal/midi-import-files.ts';
import { resolveMidiCopy } from '../../../i18n/editor-midi-copy.ts';

/** Keep the beta synthesizer and file codecs outside the initial editor graph. */
export function createMidiActionGroup(scope: EditorActionRuntime) {
	let loaded: Promise<Readonly<MidiService>> | null = null;
	let owner: Readonly<MidiService> | null = null;
	const pendingCalls = new Set<Promise<unknown>>();
	const service = () => loaded ??= import('../track-audio/midi-service.ts').then(({ createMidiService }) => owner = createMidiService({
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
	function edit<Result>(action: (service: Readonly<MidiService>) => Promise<Result>): Promise<Result> {
		const project = scope.getProject();
		const operation = owner ? action(owner) : service().then(loaded => {
			if (scope.getProject() !== project) throw new Error('The project changed before the MIDI edit.');
			return action(loaded);
		});
		pendingCalls.add(operation);
		void operation.then(() => { pendingCalls.delete(operation); }, () => { pendingCalls.delete(operation); });
		return operation;
	}
	const actions = Object.freeze({
		addTrack: () => edit(service => service.addTrack()),
		addNote: (clipId: string, note: MidiNote) => edit(service => service.addNote(clipId, note)),
		updateNote: (clipId: string, id: string, changes: Partial<MidiNote>) => edit(service => service.updateNote(clipId, id, changes)),
		updateNotes: (clipId: string, updates: readonly MidiNoteUpdate[]) => edit(service => service.updateNotes(clipId, updates)),
		deleteNotes: (clipId: string, ids: readonly string[]) => edit(service => service.deleteNotes(clipId, ids)),
		resizeClip: (clipId: string, changes: MidiClipResize) => edit(service => service.resizeClip(clipId, changes)),
		setInstrument: (trackId: string, instrument: MidiInstrument) => edit(service => service.setInstrument(trackId, instrument)),
		previewNote: async (pitch: number, instrument?: MidiInstrument) => (await service()).previewNote(pitch, instrument),
		exportFile: async (format: 'midi' | 'allegro') => (await service()).exportFile(format),
	});
	const commitTransfer = (command: AudioEditorCommand, preview: (command: AudioEditorCommand) => MidiTransferSnapshot,
		selection?: MidiTransferSelection, options?: ProjectChangedOptions): unknown => {
		const project = scope.getProject();
		const containsMidi = Boolean(project?.clips.some(clip => readMidiClip(clip)))
			|| Boolean(project?.projectBin?.clips.some(clip => readMidiClip(clip)));
		const incomingMidi = (value: AudioEditorCommand): boolean => value.type === 'batch' ? value.commands.some(incomingMidi)
			: value.type === 'clip/add' ? Boolean(readMidiClip(value.clip))
				: value.type === 'clipboard/paste' ? value.clipboard.tracks.some(track => track.clips.some(clip => Boolean(readMidiClip(clip)))) : false;
		if (!containsMidi && !incomingMidi(command)) return scope.commit(command, selection, options);
		const transfers = (value: AudioEditorCommand): boolean => value.type === 'batch' ? value.commands.some(transfers)
			: ['clip/move', 'clip/transform-many', 'clip/add', 'clipboard/paste', 'project-bin/place'].includes(value.type);
		if (!transfers(command)) return scope.commit(command, selection, options);
		const after = preview(command);
		const beforeClips = new Map(project?.clips.map(clip => [clip.id, clip]));
		const reusable = new Map<unknown, Set<string>>();
		for (const track of project?.tracks ?? []) {
			const instrument = readMidiTrack(track)?.instrument;
			if (!instrument) continue;
			for (const id of track.clipIds ?? []) {
				const sourceId = beforeClips.get(id)?.sourceId;
				if (!sourceId) continue;
				const instruments = reusable.get(sourceId) ?? new Set<string>();
				instruments.add(instrument); reusable.set(sourceId, instruments);
			}
		}
		const clips = new Map(after.clips.map(clip => [clip.id, clip]));
		const changedInstrument = after.tracks.some(track => {
			const instrument = readMidiTrack(track)?.instrument;
			return instrument && track.clipIds?.some(id => {
				const clip = clips.get(id);
				return clip && readMidiClip(clip) && !reusable.get(clip.sourceId)?.has(instrument);
			});
		});
		if (!changedInstrument && !hasPendingEdits()) return scope.commit(command, selection, options);
		return edit(service => service.commitTransfer(command, preview, selection, options));
	};
	function hasPendingEdits(): boolean { return pendingCalls.size > 0 || Boolean(owner?.hasPendingEdits()); }
	return Object.freeze({ commitTransfer, hasPendingEdits, settled: async () => {
		await Promise.allSettled([...pendingCalls]);
		if (loaded) await (await loaded).settled();
	}, actions, importFiles: createMidiImportFiles(scope, service) });
}
