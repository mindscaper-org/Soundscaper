/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiClip, createMidiTrack } from '../../midi-factory.ts';
import {
	addMidiNoteData, readMidiClip, readMidiTrack, removeMidiNoteData, updateMidiNotesData,
	normalizeMidiTrackData, type MidiClipData, type MidiInstrument,
} from '../../midi-model.ts';
import { midiDocumentFromProject } from '../../midi-project-interchange.ts';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../../commands/factories.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { AudioSourceLeaf } from '../../project-media-types.ts';
import { publishMidiSource } from './internal/midi-source-publication.ts';
import { routeMidiImportControls } from './internal/midi-import-channel-routing.ts';
import type { MidiProject, MidiService, MidiServiceDependencies } from './midi-service-types.ts';

/** Serialize edits and publish every note document together with its playable PCM fallback. */
export function createMidiService(dependencies: MidiServiceDependencies): Readonly<MidiService> {
	let pending: Promise<unknown> = Promise.resolve();
	const service: MidiService = {
		addTrack: () => enqueue(async project => {
			const bpm = project.tempo?.bpm ?? 120;
			const beats = (project.tempo?.timeSignature?.numerator ?? 4) * 4 / (project.tempo?.timeSignature?.denominator ?? 4);
			const durationFrames = Math.round(project.sampleRate * 60 / bpm * beats * 4);
			return (await importTracks(project, [{ name: dependencies.trackName(), data: { version: 1, notes: [] } }], 0, durationFrames))[0]!;
		}),
		addNote: (clipId, note) => editClip(clipId, data => addMidiNoteData(data, structuredClone(note))),
		updateNote: (clipId, id, changes) => service.updateNotes(clipId, [{ id, changes }]),
		updateNotes: (clipId, updates) => {
			const detached = structuredClone(updates);
			return editClip(clipId, data => updateMidiNotesData(data, detached));
		},
		deleteNotes: (clipId, ids) => editClip(clipId, data => removeMidiNoteData(data, [...ids])),
		resizeClip: (clipId, changes) => {
			const detached = structuredClone(changes);
			return enqueue(async project => {
				const { clip, data, trackData } = findMidi(project, clipId);
				for (const value of [detached.timelineStartFrame, detached.sourceStartFrame, detached.durationFrames]) {
					if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid MIDI clip boundary.');
				}
				if (detached.durationFrames < 1) throw new RangeError('MIDI clip duration must be positive.');
				await publishEdit(project, data, trackData.instrument,
					Math.max(Number(clip.sourceStartFrame) + Number(clip.sourceDurationFrames), detached.sourceStartFrame + detached.durationFrames), source => [
						{ type: 'midi/clip-set', clipId, data, sourceId: source.id, sourceDurationFrames: Number(clip.sourceDurationFrames) },
						{ type: 'clip/trim', clipId, ...detached, sourceDurationFrames: detached.durationFrames },
					]);
			});
		},
		setInstrument: (trackId, instrument) => enqueue(async project => {
			const track = project.tracks.find(candidate => candidate.id === trackId);
			const oldData = readMidiTrack(track);
			if (!track || !oldData) throw new ReferenceError('The MIDI track is missing.');
			if (track.locked) throw new RangeError('The MIDI track is locked.');
			const next = normalizeMidiTrackData({ ...oldData, instrument });
			const sources: AudioSourceLeaf[] = [];
			const commands: AudioEditorCommand[] = [{ type: 'midi/track-set', trackId, data: next }];
			try {
				for (const clip of project.clips.filter(candidate => Array.isArray(track.clipIds) && track.clipIds.includes(candidate.id))) {
					const data = readMidiClip(clip);
					if (!data) continue;
					const source = await publishMidiSource(dependencies, data, next.instrument, project.sampleRate,
						Number(clip.sourceStartFrame) + Number(clip.sourceDurationFrames), () => assertCurrent(project));
					sources.push(source);
					commands.push(createAddSourceCommand({ ...source }), { type: 'midi/clip-set', clipId: String(clip.id), data,
						sourceId: source.id, sourceDurationFrames: Number(clip.sourceDurationFrames) });
				}
				assertCurrent(project);
				dependencies.commit({ type: 'batch', commands });
			} catch (error) { await rollbackSources(sources, error); }
		}),
		previewNote: async (pitch, instrument = 'triangle') => {
			if (!Number.isSafeInteger(pitch) || pitch < 0 || pitch > 127) throw new RangeError('Invalid MIDI preview pitch.');
			await dependencies.previewNote(pitch, normalizeMidiTrackData({ version: 1, instrument }).instrument);
		},
		importDocument: (document, options = {}) => {
			const detached = structuredClone(document);
			return enqueue(async project => {
				options.signal?.throwIfAborted();
				if (detached.sampleRate !== project.sampleRate) throw new RangeError('MIDI import sample rate differs from the project.');
				const offset = options.timelineStartFrame ?? 0;
				if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid MIDI import position.');
				const routed = routeMidiImportControls(detached.tracks);
				const hasContent = routed.some(track => track.notes.length || track.events?.length);
				const tracks = hasContent ? routed.filter(track => track.notes.length || track.events?.length) : routed.slice(0, 1);
				return importTracks(project, tracks.map(track => ({ name: track.name || dependencies.trackName(), program: track.program,
					data: { version: 1, notes: track.notes, interchange: { events: track.events ?? [], tempos: detached.tempos, signatures: detached.signatures } } })),
				offset, Math.max(1, Math.round(project.sampleRate * 60 / (detached.tempos[0]?.bpm ?? 120) * 4)), options.signal);
			});
		},
		exportFile: async format => {
			const project = requireProject();
			const document = midiDocumentFromProject(project);
			const name = project.title.replace(/[\\/:*?"<>|]/gu, '_') || 'MIDI';
			if (format === 'midi') {
				const { writeMidiFile } = await import('../../midi-file.ts');
				return dependencies.saveFile({ purpose: 'interchange', bytes: writeMidiFile(document), mimeType: 'audio/midi', suggestedName: `${name}.mid`, extensions: ['mid', 'midi'] });
			}
			const { writeAllegroFile } = await import('../../allegro-file.ts');
			return dependencies.saveFile({ purpose: 'interchange', text: writeAllegroFile(document), mimeType: 'text/plain', suggestedName: `${name}.gro`, extensions: ['gro'] });
		},
	};
	return Object.freeze(service);

	function requireProject(): MidiProject {
		const project = dependencies.getProject();
		if (!project) throw new Error('MIDI requires an open project.');
		return project;
	}
	function assertCurrent(project: MidiProject): void {
		if (dependencies.editingBlocked()) throw new Error('MIDI editing is currently unavailable.');
		if (dependencies.getProject() !== project) throw new Error('The project changed during MIDI rendering.');
	}
	function enqueue<Result>(operation: (project: MidiProject) => Promise<Result>): Promise<Result> {
		const requested = requireProject();
		const work = pending.then(() => {
			const project = requireProject();
			if (requested.id !== project.id) throw new Error('The project changed before the MIDI edit.');
			assertCurrent(project);
			return operation(project);
		});
		pending = work.catch(() => undefined);
		return work;
	}
	function findMidi(project: MidiProject, clipId: string) {
		const clip = project.clips.find(candidate => candidate.id === clipId);
		const data = readMidiClip(clip);
		const track = project.tracks.find(candidate => Array.isArray(candidate.clipIds) && candidate.clipIds.includes(clipId));
		const trackData = readMidiTrack(track);
		if (!clip || !data || !track || !trackData) throw new ReferenceError('The MIDI clip or its track is missing.');
		if (track.locked) throw new RangeError('The MIDI track is locked.');
		return { clip, data, track, trackData };
	}
	function editClip(clipId: string, edit: (data: MidiClipData) => MidiClipData): Promise<void> {
		return enqueue(async project => {
			const { clip, data, trackData } = findMidi(project, clipId);
			const next = edit(data);
			const previousNotes = new Map(data.notes.map(note => [note.id, note]));
			const noteEnd = next.notes.reduce((end, note) => {
				const previous = previousNotes.get(note.id);
				return previous?.startFrame === note.startFrame && previous.durationFrames === note.durationFrames
					? end : Math.max(end, note.startFrame + note.durationFrames);
			}, 0);
			const sourceFrames = Math.max(Number(clip.sourceDurationFrames), noteEnd - Number(clip.sourceStartFrame));
			const durationFrames = Math.max(Number(clip.durationFrames), Math.round(sourceFrames * Number(clip.durationFrames) / Number(clip.sourceDurationFrames)));
			await publishEdit(project, next, trackData.instrument, Number(clip.sourceStartFrame) + sourceFrames, source => [
				{ type: 'midi/clip-set', clipId, data: next, sourceId: source.id, sourceDurationFrames: sourceFrames, durationFrames },
			]);
		});
	}
	async function publishEdit(project: MidiProject, data: MidiClipData, instrument: MidiInstrument,
		frames: number, commands: (source: AudioSourceLeaf) => AudioEditorCommand[]): Promise<void> {
		const source = await publishMidiSource(dependencies, data, instrument, project.sampleRate, frames, () => assertCurrent(project));
		try {
			assertCurrent(project);
			dependencies.commit({ type: 'batch', commands: [createAddSourceCommand({ ...source }), ...commands(source)] });
		} catch (error) { await rollbackSources([source], error); }
	}
	async function importTracks(project: MidiProject,
		tracks: readonly Readonly<{ name: string; data: MidiClipData; program?: number }>[], offset: number, minimumFrames: number, signal?: AbortSignal) {
		const sources: AudioSourceLeaf[] = [];
		const commands: AudioEditorCommand[] = [];
		const importedTiming = tracks[0]?.data.interchange;
		if (!project.clips.length && importedTiming) {
			const signature = importedTiming.signatures.find(event => event.frame === 0);
			const tempo = importedTiming.tempos.find(event => event.frame === 0);
			commands.push({ type: 'tempo/set', ...(tempo ? { bpm: tempo.bpm } : {}),
				...(signature ? { numerator: signature.numerator, denominator: signature.denominator } : {}) });
		}
		const created: { trackId: string; clipId: string }[] = [];
		const current = () => { signal?.throwIfAborted(); assertCurrent(project); };
		try {
			for (const imported of tracks) {
				current();
				const source = await publishMidiSource(dependencies, imported.data, 'triangle', project.sampleRate, minimumFrames, current);
				sources.push(source);
				const trackId = dependencies.createId('midi-track');
				const clipId = dependencies.createId('midi-clip');
				const track = createMidiTrack({ id: trackId, name: imported.name, program: imported.program }, project.sampleRate);
				const clip = createMidiClip({ id: clipId, sourceId: source.id, title: imported.name,
					timelineStartFrame: offset, sourceStartFrame: 0, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount,
					notes: imported.data.notes, interchange: imported.data.interchange });
				commands.push(createAddSourceCommand({ ...source }), createAddTrackCommand({ ...track }, project.sampleRate), createAddClipCommand(trackId, { ...clip }));
				created.push({ trackId, clipId });
			}
			if (!commands.length) throw new RangeError('The MIDI file has no tracks.');
			current();
			dependencies.commit({ type: 'batch', commands }, { selectTrackId: created[0]!.trackId, selectClipId: created[0]!.clipId });
			return created;
		} catch (error) { return rollbackSources(sources, error); }
	}
	async function rollbackSources(sources: readonly AudioSourceLeaf[], failure: unknown): Promise<never> {
		const currentSources = dependencies.getProject()?.sources;
		const retained = new Set(Array.isArray(currentSources) ? currentSources.map((source: Readonly<{ id: string }>) => source.id) : []);
		const results = await Promise.allSettled(sources.filter(source => !retained.has(source.id)).map(source => dependencies.store.deleteSource(source.id)));
		const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
		if (errors.length) throw new AggregateError([failure, ...errors], 'MIDI edit rollback failed.', { cause: failure });
		throw failure;
	}
}
