/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMidiClip, removeMidiClipData } from '../midi-model.ts';
import type { AudioEditorCommand } from './protocol.ts';

type DataRecord = Record<string, unknown>;

const SOURCE_REPLACEMENTS = new Set<AudioEditorCommand['type']>([
	'source/process-audio', 'source/rewrite-media',
	'clip/replace-source', 'clip/render-replace-many', 'clip/regenerate-tts',
	'clip/transform-many', 'clip/overwrite', 'clip/join',
	'project-bin/replace-media',
]);

/** Retire stale authoring metadata at the shared destructive-audio command boundary. */
export function prepareMidiSourceReplacement(
	project: DataRecord,
	command: AudioEditorCommand,
): (() => void) | null {
	if (!SOURCE_REPLACEMENTS.has(command.type)) return null;
	const clips = allClips(project).filter(clip => readMidiClip(clip) !== null);
	if (!clips.length) return null;
	const clipSources = new Map(clips.map(clip => [clip.id, clip.sourceId]));
	const sources = sourceIndex(project);
	const midiSources = new Map(clips.map(clip => [clip.sourceId, sourceIdentity(sources.get(clip.sourceId))]));
	return () => {
		const currentSources = sourceIndex(project);
		for (const clip of allClips(project)) {
			if (!readMidiClip(clip)) continue;
			const prior = clipSources.get(clip.id);
			const sourceChanged = (prior !== undefined && prior !== clip.sourceId)
				|| !midiSources.has(clip.sourceId)
				|| midiSources.get(clip.sourceId) !== sourceIdentity(currentSources.get(clip.sourceId));
			if (sourceChanged) Object.assign(clip, removeMidiClipData(clip));
		}
	};
}

function sourceIdentity(source: DataRecord | undefined): string {
	return JSON.stringify(['storageKey', 'contentSha256', 'byteLength', 'frameCount', 'sampleRate', 'channelCount']
		.map(field => source?.[field]));
}

function sourceIndex(project: DataRecord): ReadonlyMap<unknown, DataRecord> {
	return new Map(records(project.sources).map(source => [source.id, source]));
}

function allClips(project: DataRecord): DataRecord[] {
	const bin = project.projectBin as DataRecord | undefined;
	return [...records(project.clips), ...records(bin?.clips)];
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value as DataRecord[] : [];
}
