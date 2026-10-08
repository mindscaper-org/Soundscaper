/* SPDX-License-Identifier: AGPL-3.0-only */

import { validatePersistedAudioEffects } from '../common/editor/persisted-audio-effect-validation.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { normalizeProjectFeatureRequirements } from '../common/editor/project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import { reconcileSoundscaperProjectFeatureRequirements } from './editor-project-feature-requirements.ts';
import { createSoundscaperProject, validateSoundscaperProject, type SoundscaperProject } from './editor-project.ts';
import { PROJECT_SCHEMA_VERSION, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY } from './editor-project-validation.ts';
import type { SoundscaperProjectRecoveryChange } from './editor-project-recovery-types.ts';

type RecordValue = Record<string, unknown>;
export interface SoundscaperProjectRepair {
	readonly project: SoundscaperProject;
	readonly changes: readonly SoundscaperProjectRecoveryChange[];
}

/** Salvage only current owning-family data. Every admitted result passes the production validator. */
export function repairSoundscaperProject(value: unknown, availableSourceIds: ReadonlySet<string>): SoundscaperProjectRepair {
	const original = record(value);
	if (!original || original.schemaFamily !== SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		|| original.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new Error('Recovery supports only the current Soundscaper project schema.');
	}
	// Reuse the maintained codec's bounded graph traversal; never invoke accessors or repair future data.
	serializeScapeProjectDocument(original);
	const raw = structuredClone(original);
	if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error('The damaged project has no recoverable identity.');
	const changes: SoundscaperProjectRecoveryChange[] = [];
	const note = (path: string, reason: string): void => { changes.push({ path, reason }); };
	const available = new Set<string>();
	raw.sources = values(raw.sources).filter((source, index) => {
		const sourceId = record(source)?.id;
		if (typeof sourceId === 'string' && availableSourceIds.has(sourceId)) { available.add(sourceId); return true; }
		note(`sources[${String(index)}]`, 'Removed media that is missing or unreadable.');
		return false;
	});
	raw.clips = values(raw.clips).filter((clip, index) => {
		if (available.has(String(record(clip)?.sourceId))) return true;
		note(`clips[${String(index)}]`, 'Removed a clip whose media is unavailable.');
		return false;
	});
	const bin = record(raw.projectBin);
	if (bin) raw.projectBin = { ...bin, clips: values(bin.clips).filter((clip, index) => {
		if (available.has(String(record(clip)?.sourceId))) return true;
		note(`projectBin.clips[${String(index)}]`, 'Removed a bin clip whose media is unavailable.');
		return false;
	}) };
	const clipIds = ids(raw.clips);
	const trackIds = ids(raw.tracks);
	raw.tracks = values(raw.tracks).map((value, index) => {
		const track = record(value);
		if (!track) return value;
		const result = { ...track };
		if (Object.hasOwn(result, 'clipIds')) result.clipIds = references(result.clipIds, clipIds);
		if (Object.hasOwn(result, 'effects')) result.effects = repairEffects(result.effects, `tracks[${String(index)}].effects`, note);
		return result;
	});
	const master = record(raw.master);
	if (master) raw.master = { ...master, effects: repairEffects(master.effects, 'master.effects', note) };
	const selection = record(raw.selection);
	if (selection) raw.selection = { ...selection,
		trackIds: references(selection.trackIds, trackIds), clipIds: references(selection.clipIds, clipIds),
		annotationIds: references(selection.annotationIds, ids(raw.timelineAnnotations)),
	};
	const view = record(raw.view);
	if (view) raw.view = { ...view, selectedTrackIds: references(view.selectedTrackIds, trackIds) };
	try {
		reconcileRequirements(raw);
		validateSoundscaperProject(raw);
		return report(original, raw as unknown as SoundscaperProject, changes);
	} catch { /* Rebuild damaged sections independently from a valid empty authority. */ }

	let project = createSoundscaperProject({
		id: raw.id, title: typeof raw.title === 'string' ? raw.title : 'Recovered project',
		sampleRate: integer(raw.sampleRate, 1, 768_000, 48_000),
		masterChannels: integer(raw.masterChannels, 1, 64, 2),
	});
	const attempt = (path: string, update: (draft: RecordValue) => void, relationships = false): boolean => {
		const draft = structuredClone(project) as unknown as RecordValue;
		try {
			update(draft);
			if (relationships) rebuildRelations(draft);
			reconcileRequirements(draft);
			validateSoundscaperProject(draft);
			project = draft as unknown as SoundscaperProject;
			return true;
		} catch (error) {
			note(path, `Removed or reset invalid data: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	};
	for (const fields of [
		['revision'], ['createdAt'], ['updatedAt'], ['tempo', 'tempoMap', 'signatureMap'],
		['snap'], ['timeDisplay'], ['metadata'], ['loop'], ['opaqueExtensions'], ['master'],
	] as const) {
		attempt(fields.join(', '), (draft) => { for (const field of fields) draft[field] = raw[field]; });
	}
	for (const [index, source] of values(raw.sources).entries()) {
		attempt(`sources[${String(index)}]`, (draft) => { draft.sources = [...values(draft.sources), source]; });
	}
	// Recover sequence clocks first; hierarchy and ownership are rebuilt as tracks are admitted.
	const sequences = values(raw.sequences).flatMap((value) => {
		const sequence = record(value);
		return sequence ? [{ ...sequence, trackIds: [], trackNodes: [] }] : [];
	});
	attempt('sequences', (draft) => { draft.sequences = sequences; draft.primarySequenceId = raw.primarySequenceId; });
	for (const [index, value] of values(raw.tracks).entries()) {
		const track = record(value);
		if (!track) { note(`tracks[${String(index)}]`, 'Removed an invalid track.'); continue; }
		const candidate = { ...track };
		if (Object.hasOwn(candidate, 'clipIds')) candidate.clipIds = [];
		delete candidate.audioFreeze;
		candidate.laneGroupId = null;
		const addTrack = (value: unknown): boolean => attempt(`tracks[${String(index)}]`, (draft) => {
			draft.tracks = [...values(draft.tracks), value];
			const owner = values(raw.sequences).map(record).find((sequence) => values(sequence?.trackIds).includes(candidate.id));
			draft.sequences = values(draft.sequences).map((value) => {
				const sequence = record(value)!;
				return sequence.id === (owner?.id ?? draft.primarySequenceId) ? { ...sequence, trackIds: [...values(sequence.trackIds), candidate.id] } : sequence;
			});
		}, true);
		if (addTrack(candidate)) continue;
		if (typeof track.id !== 'string' || !track.id.trim() || !['audio', 'label', 'video'].includes(String(track.type))) continue;
		const defaultTrack = createSoundscaperProject({
			id: raw.id, sampleRate: project.sampleRate, masterChannels: project.masterChannels,
			tracks: [{ id: track.id, type: track.type }],
		}).tracks[0];
		if (!addTrack(defaultTrack)) continue;
		for (const field of Object.keys(candidate)) {
			if (['id', 'type', 'clipIds', 'laneGroupId', 'audioFreeze'].includes(field)) continue;
			attempt(`tracks[${String(index)}].${field}`, (draft) => {
				draft.tracks = values(draft.tracks).map((value) => {
					const current = record(value)!;
					return current.id === track.id ? { ...current, [field]: candidate[field] } : current;
				});
			}, true);
		}
	}
	const acceptedTracks = ids(project.tracks);
	for (const [index, clip] of values(raw.clips).entries()) {
		const owner = values(raw.tracks).map(record).find((track) =>
			track && acceptedTracks.has(String(track.id)) && values(track.clipIds).includes(record(clip)?.id));
		if (!owner) { note(`clips[${String(index)}]`, 'Removed a clip without a valid owning track.'); continue; }
		attempt(`clips[${String(index)}]`, (draft) => {
			draft.clips = [...values(draft.clips), clip];
			draft.tracks = values(draft.tracks).map((value) => {
				const track = record(value)!;
				return track.id === owner.id ? { ...track, clipIds: [...values(track.clipIds), record(clip)?.id] } : track;
			});
		}, true);
	}
	for (const [index, clip] of values(record(raw.projectBin)?.clips).entries()) {
		attempt(`projectBin.clips[${String(index)}]`, (draft) => {
			draft.projectBin = { ...record(draft.projectBin), clips: [...values(record(draft.projectBin)?.clips), clip] };
		});
	}
	for (const field of ['timelineAnnotations', 'takeGroups', 'nativePluginStates', 'assistanceAssets', 'masteringSequences'] as const) {
		for (const [index, item] of values(raw[field]).entries()) {
			attempt(`${field}[${String(index)}]`, (draft) => { draft[field] = [...values(draft[field]), item]; });
		}
	}
	// Folders and their buses are one graph invariant. Restore them together before
	// admitting automation, whose addresses may point at those mixer nodes.
	const restoreHierarchy = (draft: RecordValue): void => {
		draft.trackFolders = raw.trackFolders;
		draft.sequences = values(draft.sequences).map((value) => {
			const sequence = record(value)!;
			const saved = values(raw.sequences).map(record).find((saved) => saved?.id === sequence.id);
			return saved ? { ...sequence, trackNodes: values(saved.trackNodes).filter((value) => {
				const node = record(value);
				return node?.kind !== 'track' || acceptedTracks.has(String(node.id));
			}) } : sequence;
		});
	};
	if (!attempt('trackFolders, sequences, mixer', (draft) => { restoreHierarchy(draft); draft.mixer = raw.mixer; })) {
		attempt('trackFolders, sequences', (draft) => {
			restoreHierarchy(draft);
			draft.mixer = createSoundscaperProject({ ...draft, mixer: undefined, tracks: values(draft.tracks) as RecordValue[] }).mixer;
		});
		attempt('mixer', (draft) => { draft.mixer = raw.mixer; });
	}
	for (const [index, lane] of values(raw.automationLanes).entries()) {
		attempt(`automationLanes[${String(index)}]`, (draft) => { draft.automationLanes = [...values(draft.automationLanes), lane]; });
	}
	for (const field of ['selection', 'view', 'featureRequirements'] as const) {
		attempt(field, (draft) => { draft[field] = raw[field]; });
	}
	validateSoundscaperProject(project);
	return report(original, project, changes);
}

function rebuildRelations(draft: RecordValue): void {
	const tracks = values(draft.tracks).map(record).filter((track): track is RecordValue => track !== null);
	const primaryId = String(draft.primarySequenceId);
	const allTrackIds = new Set(tracks.map((track) => String(track.id)));
	const assigned = new Set(values(draft.sequences).flatMap((value) => references(record(value)?.trackIds, allTrackIds)));
	const sequences = values(draft.sequences).map((value) => {
		const sequence = record(value)!;
		const trackIds = references(sequence.trackIds, allTrackIds);
		if (sequence.id === primaryId) trackIds.push(...[...allTrackIds].filter((id) => !assigned.has(id)));
		return { ...sequence, trackIds, trackNodes: trackIds.map((id) => ({ kind: 'track', id, parentFolderId: null })) };
	});
	draft.sequences = sequences;
	const factory = createSoundscaperProject({
		id: String(draft.id), sampleRate: Number(draft.sampleRate), masterChannels: Number(draft.masterChannels),
		tracks, sources: values(draft.sources) as RecordValue[], clips: values(draft.clips) as RecordValue[],
		sequences, primarySequenceId: primaryId,
		tempo: record(draft.tempo) ?? {}, tempoMap: draft.tempoMap, signatureMap: draft.signatureMap,
	});
	draft.mixer = factory.mixer;
}

function reconcileRequirements(draft: RecordValue): void {
	const empty = { schemaVersion: 2 as const, requirements: [] };
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(draft,
		reconcileProjectOwnedFeatureRequirements(draft, normalizeProjectFeatureRequirements(draft.featureRequirements ?? empty, { ...draft, sources: values(draft.sources) as RecordValue[], clips: values(draft.clips) as RecordValue[], tracks: values(draft.tracks) as RecordValue[] })));
}
function repairEffects(value: unknown, path: string, note: (path: string, reason: string) => void): unknown[] {
	const result: unknown[] = [];
	for (const [index, effect] of values(value).entries()) {
		try { validatePersistedAudioEffects([...result, effect], path); result.push(effect); }
		catch (error) { note(`${path}[${String(index)}]`, `Removed an invalid effect: ${error instanceof Error ? error.message : String(error)}`); }
	}
	return result;
}
function report(original: RecordValue, project: SoundscaperProject, changes: SoundscaperProjectRecoveryChange[]): SoundscaperProjectRepair {
	for (const key of Object.keys(original)) {
		if (!sameProjectSnapshot(original[key], project[key]) && !changes.some(({ path }) => path === key || path.startsWith(`${key}[`))) {
			changes.push({ path: key, reason: 'Rebuilt or reset damaged data and references.' });
		}
	}
	return { project, changes: Object.freeze(changes.map((change) => Object.freeze(change))) };
}
function values(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function record(value: unknown): RecordValue | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null; }
function ids(value: unknown): Set<string> { return new Set(values(value).flatMap((value) => typeof record(value)?.id === 'string' ? [String(record(value)!.id)] : [])); }
function references(value: unknown, admitted: ReadonlySet<string>): string[] { return [...new Set(values(value).filter((id): id is string => typeof id === 'string' && admitted.has(id)))]; }
function integer(value: unknown, minimum: number, maximum: number, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : fallback;
}
