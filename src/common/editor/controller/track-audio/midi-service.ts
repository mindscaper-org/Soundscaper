/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiClip, createMidiTrack } from '../../midi-factory.ts';
import { EditorProjectChangedError } from '../shared/lifecycle.ts';
import {
	addMidiNoteData, readMidiClip, readMidiTrack, removeMidiNoteData, updateMidiNotesData,
	normalizeMidiTrackData, withMidiTrackData, type MidiClipData, type MidiInstrument,
} from '../../midi-model.ts';
import { midiDocumentFromProject } from '../../midi-project-interchange.ts';
import { midiProjectTiming } from '../../midi-project-timing.ts';
import { midiInitialTimingEvent } from '../../midi-initial-timing.ts';
import { trimAudioWarpClipToTimelineRange } from '../../audio-warp-clip-edit.ts';
import { roundRational } from '../../timeline-time.ts';
import { barStartBeat } from '../../musical-grid.ts';
import { createIndexedBeatFrameProjector } from '../../indexed-tempo-projector.ts';
import { resolveRuntimeClipProjection } from '../../runtime-clip-projection.ts';
import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../../commands/factories.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { AudioSourceLeaf } from '../../project-media-types.ts';
import { clipLoopUpdateFields, readClipLoop } from '../../audio-clip-loop.ts';
import { publishMidiSource } from './internal/midi-source-publication.ts';
import { retainedMidiSourceFrames } from './internal/midi-source-retention.ts';
import { midiTransferExtensions } from '../../commands/midi-transfer-context.ts';
import { routeMidiImportControls } from './internal/midi-import-channel-routing.ts';
import { prepareMidiTransferPublication } from './internal/midi-transfer-publication.ts';
import { midiWarpNoteGrowth } from './internal/midi-warp-note-growth.ts';
import { deliverMidiFile } from './internal/midi-file-delivery.ts';
import type { MidiProject, MidiService, MidiServiceDependencies } from './midi-service-types.ts';

type ImportedMidiTrack = Readonly<{ name: string; data: MidiClipData; program?: number; durationFrames?: number }>;

/** Serialize edits and publish every note document together with its playable PCM fallback. */
export function createMidiService(dependencies: MidiServiceDependencies): Readonly<MidiService> {
	let pending: Promise<unknown> = Promise.resolve();
	const requests = new Set<{ expected: MidiProject }>();
	const waiters = new Set<{ expected: MidiProject }>();
	const deliveries = new Set<{ expected: MidiProject }>();
	let active: { origin: MidiProject; request: { expected: MidiProject } } | null = null;
	const service: MidiService = {
		followSelection: (before, after) => {
			for (const request of [...requests, ...waiters, ...deliveries]) if (request.expected === before) request.expected = after;
		},
		settled: async (expectedProject, readiness) => {
			if (!expectedProject) { await pending; return; }
			const waiter = { expected: expectedProject }; waiters.add(waiter);
			try {
				await Promise.all([pending, readiness]);
				if (dependencies.getProject() !== waiter.expected) throw new DOMException('The document changed before recording.', 'AbortError');
			} finally { waiters.delete(waiter); }
		},
		hasPendingEdits: () => requests.size > 0,
		commitTransfer: (command, preview, selection, options) => {
			const detached = structuredClone(command);
			return enqueue(async project => {
				const sources: AudioSourceLeaf[] = [];
				try {
					const additions = await prepareMidiTransferPublication(dependencies, {
						clips: project.clips.map(clip => ({ ...clip, id: String(clip.id) })),
						tracks: project.tracks.flatMap(track => Array.isArray(track.clipIds) ? [{ ...track, clipIds: track.clipIds.filter((id: unknown): id is string => typeof id === 'string') }] : []),
					}, preview(detached), () => assertCurrent(project), sources);
					assertCurrent(project);
					return commitOwned(additions.length ? { type: 'batch', commands: [detached, ...additions] } : detached, selection, options);
				} catch (error) { return rollbackSources(sources, error); }
			});
		},
		addTrack: () => enqueue(async project => {
			const timing = midiProjectTiming(project);
			const durationFrames = createIndexedBeatFrameProjector(timing.tempoMap, project.sampleRate)(barStartBeat(4, timing.signatureMap));
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
				const warped = clip.warpMap == null ? null : trimAudioWarpClipToTimelineRange(
					{ ...project, tempoMap: midiProjectTiming(project).tempoMap }, clip,
					detached.timelineStartFrame, detached.timelineStartFrame + detached.durationFrames);
				const loop = readClipLoop(clip);
				const loopChange = loop ? { ...loop, durationFrames: detached.durationFrames,
					sourceStartFrame: detached.sourceStartFrame, sourceDurationFrames: Number(clip.sourceDurationFrames) } : null;
				const loopFields = loopChange ? clipLoopUpdateFields({ ...clip, kind: 'audio',
					durationFrames: Number(clip.durationFrames), sourceStartFrame: Number(clip.sourceStartFrame),
					sourceDurationFrames: Number(clip.sourceDurationFrames) }, loopChange) : null;
				const sourceDurationFrames = warped?.sourceDurationFrames ?? loopFields?.sourceDurationFrames
					?? Math.max(1, Math.round(detached.durationFrames * Number(clip.sourceDurationFrames) / Number(clip.durationFrames)));
				const sourceStartFrame = warped?.sourceStartFrame ?? loopFields?.sourceStartFrame ?? detached.sourceStartFrame;
				await publishEdit(project, clip, data, trackData.instrument,
					Math.max(Number(clip.sourceStartFrame) + Number(clip.sourceDurationFrames), sourceStartFrame + sourceDurationFrames), source => [
						{ type: 'midi/clip-set', clipId, data, sourceId: source.id, sourceDurationFrames: Number(clip.sourceDurationFrames) },
						{ type: 'clip/trim', clipId, ...detached, sourceStartFrame, sourceDurationFrames },
						...(loopChange ? [{ type: 'clip/update' as const, clipId, changes: { loop: loopChange } }] : []),
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
					const source = await publishMidiSource(dependencies, data, next.instrument, sourceSampleRate(project, clip),
						retainedMidiSourceFrames(project.sources?.find(source => source.id === clip.sourceId),
							Number(clip.sourceStartFrame) + Number(clip.sourceDurationFrames)), () => assertCurrent(project));
					sources.push(source);
					commands.push(createAddSourceCommand({ ...source }), { type: 'midi/clip-set', clipId: String(clip.id), data,
						sourceId: source.id, sourceDurationFrames: Number(clip.sourceDurationFrames) });
				}
				assertCurrent(project);
				commitOwned({ type: 'batch', commands });
			} catch (error) { await rollbackSources(sources, error); }
		}),
		previewNote: async (pitch, instrument = 'triangle', signal) => {
			signal?.throwIfAborted();
			if (!Number.isSafeInteger(pitch) || pitch < 0 || pitch > 127) throw new RangeError('Invalid MIDI preview pitch.');
			await dependencies.previewNote(pitch, normalizeMidiTrackData({ version: 1, instrument }).instrument, signal);
		},
		importDocument: (document, options = {}) => {
			const detached = structuredClone(document);
			return enqueue(async project => {
				options.signal?.throwIfAborted();
				if (detached.sampleRate !== project.sampleRate) throw new RangeError('MIDI import sample rate differs from the project.');
				const offset = options.timelineStartFrame ?? 0;
				if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid MIDI import position.');
				const routed = routeMidiImportControls(detached.tracks);
				const authored = routed.filter((track, index) => track.notes.length || track.events?.length
					|| !track.conductorOnly && !detached.tracks[index]?.events?.length);
				const tracks = authored.length ? authored : routed.slice(0, 1);
				const emptyTrackEnd = routed.filter(track => !tracks.includes(track))
					.reduce((end, track) => Math.max(end, track.durationFrames ?? 0), 0);
				const prepared = tracks.map(track => ({ name: track.name || dependencies.trackName(), program: track.program,
					durationFrames: track.durationFrames,
					data: { version: 1 as const, notes: track.notes, interchange: { events: track.events ?? [], tempos: detached.tempos, signatures: detached.signatures } } }));
				const minimumFrames = Math.max(1, emptyTrackEnd);
				return options.destination === 'project-bin' ? importBinTracks(project, prepared, minimumFrames, options.signal)
					: importTracks(project, prepared, offset, minimumFrames, options.signal);
			});
		},
		exportFile: async format => {
			const requested = requireProject();
			await pending;
			const project = requireProject();
			if (project.id !== requested.id) throw new EditorProjectChangedError();
			const document = midiDocumentFromProject(project);
			const name = project.title.replace(/[\\/:*?"<>|]/gu, '_') || 'MIDI';
			const waiter = { expected: project }; deliveries.add(waiter);
			try { return await deliverMidiFile(dependencies, document, format, name, () => dependencies.getProject() === waiter.expected, project); }
			finally { deliveries.delete(waiter); }
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
		const expected = active?.origin === project ? active.request.expected : project;
		if (dependencies.getProject() !== expected) throw new EditorProjectChangedError();
	}
	function commitOwned(...args: Parameters<MidiServiceDependencies['commit']>): unknown {
		const previous = requireProject();
		const result = dependencies.commit(...args);
		const next = requireProject();
		for (const request of [...requests, ...waiters]) if (request.expected === previous) request.expected = next;
		return result;
	}
	function enqueue<Result>(operation: (project: MidiProject) => Promise<Result>): Promise<Result> {
		const request = { expected: requireProject() };
		requests.add(request);
		const work = pending.then(async () => {
			const project = requireProject();
			if (request.expected !== project) throw new EditorProjectChangedError();
			assertCurrent(project);
			active = { origin: project, request };
			try { return await operation(project); }
			finally { active = null; }
		}).finally(() => { requests.delete(request); });
		pending = work.catch(() => undefined);
		return work;
	}
	function findMidi(project: MidiProject, clipId: string) {
		const persisted = project.clips.find(candidate => candidate.id === clipId);
		const clip = persisted ? resolveRuntimeClipProjection({ ...project, tempoMap: midiProjectTiming(project).tempoMap }, persisted) : undefined;
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
			const warpedGrowth = midiWarpNoteGrowth(project, clip, sourceFrames);
			const durationFrames = warpedGrowth?.durationFrames
				?? Math.max(Number(clip.durationFrames), Math.round(sourceFrames * Number(clip.durationFrames) / Number(clip.sourceDurationFrames)));
			const loop = readClipLoop(clip);
			const periodFrames = loop ? Math.max(1, Math.round(loop.periodFrames * sourceFrames / Number(clip.sourceDurationFrames))) : 0;
			const offsetFrames = loop ? Math.min(periodFrames - 1, roundRational(
				BigInt(loop.offsetFrames) * BigInt(periodFrames) * BigInt(Number(clip.sourceDurationFrames)),
				BigInt(loop.periodFrames) * BigInt(sourceFrames), 'point')) : 0;
			await publishEdit(project, clip, next, trackData.instrument, Number(clip.sourceStartFrame) + sourceFrames, source => [
				{ type: 'midi/clip-set', clipId, data: next, sourceId: source.id, sourceDurationFrames: sourceFrames, durationFrames, ...warpedGrowth },
				...(loop && sourceFrames !== Number(clip.sourceDurationFrames) ? [{ type: 'clip/update' as const, clipId, changes: { loop: {
					periodFrames, offsetFrames, durationFrames,
				} } }] : []),
			]);
		});
	}
	function sourceSampleRate(project: MidiProject, clip: Readonly<Record<string, unknown>>): number {
		const source = project.sources?.find(candidate => candidate.id === clip.sourceId);
		return source?.kind === 'audio' && Number.isSafeInteger(source.sampleRate) && Number(source.sampleRate) > 0
			? Number(source.sampleRate) : project.sampleRate;
	}
	async function publishEdit(project: MidiProject, clip: Readonly<Record<string, unknown>>, data: MidiClipData, instrument: MidiInstrument,
		frames: number, commands: (source: AudioSourceLeaf) => AudioEditorCommand[]): Promise<void> {
		const source = await publishMidiSource(dependencies, data, instrument, sourceSampleRate(project, clip),
			retainedMidiSourceFrames(project.sources?.find(source => source.id === clip.sourceId), frames), () => assertCurrent(project));
		try {
			assertCurrent(project);
			commitOwned({ type: 'batch', commands: [createAddSourceCommand({ ...source }), ...commands(source)] });
		} catch (error) { await rollbackSources([source], error); }
	}
	async function importTracks(project: MidiProject,
		tracks: readonly ImportedMidiTrack[], offset: number, minimumFrames: number, signal?: AbortSignal) {
		const sources: AudioSourceLeaf[] = [];
		const commands: AudioEditorCommand[] = [];
		const importedTiming = tracks[0]?.data.interchange;
		if (!project.clips.length && importedTiming) {
			const signature = midiInitialTimingEvent(importedTiming.signatures);
			const tempo = midiInitialTimingEvent(importedTiming.tempos);
			commands.push({ type: 'tempo/set', ...(tempo ? { bpm: tempo.bpm } : {}),
				...(signature ? { numerator: signature.numerator, denominator: signature.denominator } : {}) });
		}
		const created: { trackId: string; clipId: string }[] = [];
		const current = () => { signal?.throwIfAborted(); assertCurrent(project); };
		try {
			for (const imported of tracks) {
				current();
				const source = await publishMidiSource(dependencies, imported.data, 'triangle', project.sampleRate,
					Math.max(minimumFrames, imported.durationFrames ?? 0), current);
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
			commitOwned({ type: 'batch', commands }, { selectTrackId: created[0]!.trackId, selectClipId: created[0]!.clipId });
			return created;
		} catch (error) { return rollbackSources(sources, error); }
	}
	async function importBinTracks(project: MidiProject, tracks: readonly ImportedMidiTrack[], minimumFrames: number, signal?: AbortSignal) {
		const sources: AudioSourceLeaf[] = [];
		const commands: AudioEditorCommand[] = [];
		const created: { trackId: null; clipId: string }[] = [];
		const current = () => { signal?.throwIfAborted(); assertCurrent(project); };
		try {
			for (const imported of tracks) {
				current();
				const source = await publishMidiSource(dependencies, imported.data, 'triangle', project.sampleRate,
					Math.max(minimumFrames, imported.durationFrames ?? 0), current);
				sources.push(source);
				const clipId = dependencies.createId('midi-clip');
				const clip = createMidiClip({ id: clipId, sourceId: source.id, title: imported.name,
					durationFrames: source.frameCount, notes: imported.data.notes, interchange: imported.data.interchange });
				const context = withMidiTrackData({ type: 'audio' }, { version: 1, instrument: 'triangle', program: imported.program });
				commands.push(createAddSourceCommand({ ...source }), { type: 'project-bin/add', clip: {
					...clip, opaqueExtensions: midiTransferExtensions({ ...clip }, context),
				} });
				created.push({ trackId: null, clipId });
			}
			if (!commands.length) throw new RangeError('The MIDI file has no tracks.');
			current();
			commitOwned({ type: 'batch', commands });
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
