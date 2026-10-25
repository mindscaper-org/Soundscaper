/* SPDX-License-Identifier: AGPL-3.0-only */

import { frozenRecordIdIndex, hasOwnDataValue } from '../frozen-record-id-index.ts';
import { findClip, findClipTrack } from '../project.js';

interface Clip { readonly id: string }
interface Track { readonly id: string; readonly clipIds?: readonly string[] }
interface Project { readonly clips: readonly Clip[]; readonly tracks: readonly Track[] }

/** Resolve each trim companion against immutable first-match identities for this invocation. */
export function frozenTrimParticipants(project: Project, demand: number) {
	const clips = demand >= 8 ? dataArray<Clip>(project, 'clips') : null;
	const tracks = demand >= 8 ? dataArray<Track>(project, 'tracks') : null;
	const clipById = clips ? frozenRecordIdIndex(clips) : null;
	const trackById = tracks ? frozenRecordIdIndex(tracks) : null;
	const owners = tracks && trackById ? ownerIndex(tracks) : null;
	return {
		clip: (id: string): Clip | null => clipById && hasOwnDataValue(project, 'clips', clips)
			? clipById.get(id) ?? null : findClip(project, id) as Clip | null,
		owner: (id: string): Track | null => owners && hasOwnDataValue(project, 'tracks', tracks)
			? owners.get(id) ?? null : findClipTrack(project, id) as Track | null,
	};
}

function dataArray<Item>(project: object, field: string): readonly Item[] | null {
	const descriptor = Object.getOwnPropertyDescriptor(project, field);
	return descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value)
		? descriptor.value as Item[] : null;
}

function ownerIndex(tracks: readonly Track[]): ReadonlyMap<string, Track> | null {
	const owners = new Map<string, Track>();
	for (const track of tracks) {
		const descriptor = Object.getOwnPropertyDescriptor(track, 'clipIds');
		if ((descriptor && !Object.hasOwn(descriptor, 'value')) || (!descriptor && 'clipIds' in track)) return null;
		const ids = descriptor?.value as unknown;
		if (!Array.isArray(ids)) continue;
		if (!Object.isFrozen(ids) || Object.getPrototypeOf(ids) !== Array.prototype
			|| Object.hasOwn(ids, 'includes') || Object.hasOwn(ids, Symbol.iterator)) return null;
		for (let slot = 0; slot < ids.length; slot++) {
			const entry = Object.getOwnPropertyDescriptor(ids, String(slot));
			if (!entry || !Object.hasOwn(entry, 'value') || typeof entry.value !== 'string') return null;
			if (!owners.has(entry.value)) owners.set(entry.value, track);
		}
	}
	return owners;
}
