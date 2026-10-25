/* SPDX-License-Identifier: AGPL-3.0-only */

import { frozenRecordIdIndex, hasOwnDataValue } from '../../../../frozen-record-id-index.ts';
import type { ClipTransformClip, ClipTransformProject, ClipTransformTrack } from './clip-domain-types.ts';

function frozenField<Item extends { readonly id: string }>(project: object, key: string) {
	const descriptor = Object.getOwnPropertyDescriptor(project, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) return null;
	const array = descriptor.value as Item[];
	const index = frozenRecordIdIndex(array);
	return index ? { array, index } : null;
}

function immutableOwners(tracks: readonly ClipTransformTrack[]) {
	const all = new Map<string, ClipTransformTrack>(), media = new Map<string, ClipTransformTrack>();
	for (const track of tracks) {
		const type = Object.getOwnPropertyDescriptor(track, 'type');
		const members = Object.getOwnPropertyDescriptor(track, 'clipIds');
		if (!type || !Object.hasOwn(type, 'value') || typeof type.value !== 'string'
			|| (members && !Object.hasOwn(members, 'value')) || (!members && 'clipIds' in track)) return null;
		const ids = members?.value as unknown;
		if (ids === undefined || ids === null) continue;
		if (!Array.isArray(ids) || !Object.isFrozen(ids) || Object.getPrototypeOf(ids) !== Array.prototype
			|| Object.hasOwn(ids, 'includes') || Object.hasOwn(ids, Symbol.iterator)) return null;
		for (let slot = 0; slot < ids.length; slot++) {
			const descriptor = Object.getOwnPropertyDescriptor(ids, String(slot));
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
			const id = descriptor.value;
			if (!all.has(id)) all.set(id, track);
			if (type.value !== 'label' && !media.has(id)) media.set(id, track);
		}
	}
	return { all, media };
}

/** These maps die with one gesture and preserve first-match duplicate authority. */
export function createClipTransformReaders(project: ClipTransformProject, timeline: readonly ClipTransformTrack[] = []) {
	const clips = frozenField<ClipTransformClip>(project, 'clips');
	const tracks = frozenField<ClipTransformTrack>(project, 'tracks');
	const owners = tracks ? immutableOwners(tracks.array) : null;
	const positions = new Map<string, number>(), ownerPositions = new Map<string, number>();
	if (owners) for (let index = 0; index < timeline.length; index++) {
		const track = timeline[index]!;
		if (!positions.has(track.id)) positions.set(track.id, index);
		for (const id of track.clipIds ?? []) if (!ownerPositions.has(id)) ownerPositions.set(id, index);
	}
	return {
		clip: (id: string | null): ClipTransformClip | null => clips && hasOwnDataValue(project, 'clips', clips.array)
			? id === null ? null : clips.index.get(id) ?? null : project.clips.find(clip => clip.id === id) ?? null,
		owner: (id: string): ClipTransformTrack | null => owners && hasOwnDataValue(project, 'tracks', tracks!.array)
			? owners.media.get(id) ?? null : project.tracks.find(track => track.type !== 'label' && track.clipIds?.includes(id)) ?? null,
		anyOwner: (id: string): ClipTransformTrack | undefined => owners && hasOwnDataValue(project, 'tracks', tracks!.array)
			? owners.all.get(id) : project.tracks.find(track => track.clipIds?.includes(id)),
		trackIndex: (id: string | undefined): number => owners ? id === undefined ? -1 : positions.get(id) ?? -1 : timeline.findIndex(track => track.id === id),
		ownerIndex: (id: string): number => owners ? ownerPositions.get(id) ?? -1 : timeline.findIndex(track => track.clipIds!.includes(id)),
	};
}
