/* SPDX-License-Identifier: AGPL-3.0-only */

import { frozenRecordIdIndex } from './frozen-record-id-index.ts';
import type { AdmTerminalStripKind, RoutingProject } from './adm-project-metadata.ts';

/** Repeated invalid references still distinguish missing strips from nonterminals. */
export function createAdmStripExistenceReader(project: RoutingProject): (kind: AdmTerminalStripKind, id: string) => boolean {
	const prepared = new Map<AdmTerminalStripKind, { array: readonly unknown[]; ids: ReadonlySet<string> }>();
	return (kind, id) => {
		const collection = collectionData(project, kind);
		if (Array.isArray(collection)) {
			let entry = prepared.get(kind);
			if (entry?.array !== collection) {
				const ids = stripIds(collection as Readonly<{ readonly id: string }>[], kind === 'track');
				if (ids) { entry = { array: collection, ids }; prepared.set(kind, entry); }
				else entry = undefined;
			}
			if (entry) return entry.ids.has(id);
		}
		return kind === 'track'
			? Boolean(project.tracks?.some(track => track.type === 'audio' && track.id === id))
			: Boolean(project.mixer?.[kind === 'group' ? 'groups' : 'sends']?.some(bus => bus.id === id));
	};
}

function collectionData(project: RoutingProject, kind: AdmTerminalStripKind): unknown {
	if (kind === 'track') return ownData(project, 'tracks');
	const mixer = ownData(project, 'mixer');
	return mixer && typeof mixer === 'object' ? ownData(mixer, kind === 'group' ? 'groups' : 'sends') : undefined;
}

function ownData(value: object, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as unknown : undefined;
}

function stripIds(values: readonly { readonly id: string }[], audioOnly: boolean): ReadonlySet<string> | null {
	const records = frozenRecordIdIndex(values);
	if (!records) return null;
	if (!audioOnly) return new Set(records.keys());
	const ids = new Set<string>();
	for (const value of values) {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
		if (descriptor.value === 'audio') ids.add(value.id);
	}
	return ids;
}
