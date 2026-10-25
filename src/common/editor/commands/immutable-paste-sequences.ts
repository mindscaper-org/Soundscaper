/* SPDX-License-Identifier: AGPL-3.0-only */

import { frozenRecordIdIndex } from '../frozen-record-id-index.ts';

type DataRecord = Record<string, unknown>;
interface Sequence extends DataRecord { readonly id: string }

/** Destination ownership is reused only while all fields the legacy lookup reads stay inert. */
export function immutablePasteSequences(project: DataRecord) {
	const tracks = own(project, 'tracks'), sequences = own(project, 'sequences');
	const primary = Object.getOwnPropertyDescriptor(project, 'primarySequenceId');
	const sampleRate = Object.getOwnPropertyDescriptor(project, 'sampleRate');
	if (!Array.isArray(tracks) || !Array.isArray(sequences)
		|| !primary || !Object.hasOwn(primary, 'value') || !sampleRate || !Object.hasOwn(sampleRate, 'value')) return null;
	const trackById = frozenRecordIdIndex(tracks as { readonly id: string }[]);
	const sequenceById = frozenRecordIdIndex(sequences as Sequence[]);
	if (!trackById || !sequenceById) return null;
	const ownerByTrack = new Map<string, Sequence>();
	for (const sequence of sequences as Sequence[]) {
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(sequence))) if (!Object.hasOwn(descriptor, 'value')) return null;
		const members = own(sequence, 'trackIds');
		if (members === undefined || members === null) {
			if ('trackIds' in sequence && !Object.hasOwn(sequence, 'trackIds')) return null;
			continue;
		}
		if (!Array.isArray(members) || !Object.isFrozen(members) || Object.getPrototypeOf(members) !== Array.prototype
			|| Object.hasOwn(members, 'includes') || Object.hasOwn(members, Symbol.iterator)) return null;
		for (let index = 0; index < members.length; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(members, String(index));
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
			if (!ownerByTrack.has(descriptor.value)) ownerByTrack.set(descriptor.value, sequence);
		}
	}
	return {
		matches: (): boolean => matchesOwn(project, 'tracks', tracks) && matchesOwn(project, 'sequences', sequences)
			&& matchesOwn(project, 'primarySequenceId', primary.value) && matchesOwn(project, 'sampleRate', sampleRate.value),
		hasTrack: (id: string): boolean => trackById.has(id),
		sequenceId: (trackId: string, planned?: string | null): unknown => {
			if (!trackById.has(trackId)) return planned ?? primary.value as unknown;
			const sequence = ownerByTrack.get(trackId) ?? sequenceById.get(primary.value as string);
			if (!sequence) throw new ReferenceError(`Track ${trackId} does not belong to a sequence.`);
			return sequence.id;
		},
		hasSequence: (id: string): boolean => sequenceById.has(id),
	};
}

function own(value: object, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as unknown : undefined;
}

function matchesOwn(value: object, field: string, expected: unknown): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === expected);
}
