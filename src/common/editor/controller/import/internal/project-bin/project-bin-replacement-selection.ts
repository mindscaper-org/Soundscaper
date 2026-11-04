/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { ProjectBinDocumentSnapshot, ProjectBinProject } from '../../project-bin-types.ts';

type SelectionCommand = Extract<AudioEditorCommand, { type: 'selection/set' }>;
const BOOKKEEPING = new Set(['selection', 'revision', 'updatedAt']);

/** Only a selection command may be replayed after restoring temporary import history. */
export function replacementSelectionChange(
	base: ProjectBinProject, importedDocument: ProjectBinDocumentSnapshot, latestDocument: ProjectBinDocumentSnapshot,
): SelectionCommand | null {
	const imported = importedDocument.project, latest = latestDocument.project;
	if (!sameContent(imported, latest, BOOKKEEPING)
		|| !sameContent(importedDocument.history, latestDocument.history, new Set(['present']))) return null;
	const selection = latest.selection;
	if (!selection || typeof selection !== 'object') return null;
	const startFrame = data(selection, 'startFrame'), endFrame = data(selection, 'endFrame');
	if (!frame(startFrame) || !frame(endFrame)) return null;
	const annotations = data(base, 'timelineAnnotations');
	const annotationIds = Array.isArray(annotations) ? new Set(annotations.map(row => data(row, 'id')).filter((id): id is string => typeof id === 'string')) : null;
	const frequency = data(selection, 'frequencyRange');
	const minimumFrequency = data(frequency, 'minimumFrequency'), maximumFrequency = data(frequency, 'maximumFrequency');
	return {
		type: 'selection/set', startFrame, endFrame,
		trackIds: selectedIds(data(selection, 'trackIds'), new Set(base.tracks.map(track => track.id))),
		clipIds: selectedIds(data(selection, 'clipIds'), new Set(base.clips.map(clip => clip.id))),
		...(annotationIds ? { annotationIds: selectedIds(data(selection, 'annotationIds'), annotationIds) } : {}),
		frequencyRange: typeof minimumFrequency === 'number' && typeof maximumFrequency === 'number'
			? { minimumFrequency, maximumFrequency } : null,
	};
}

function sameContent(first: unknown, second: unknown, ignored: ReadonlySet<string>): boolean {
	if (Object.is(first, second)) return true;
	if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
	const firstKeys = Object.keys(first).filter(key => !ignored.has(key));
	const secondKeys = Object.keys(second).filter(key => !ignored.has(key));
	return firstKeys.length === secondKeys.length && firstKeys.every(key => {
		const left = Object.getOwnPropertyDescriptor(first, key), right = Object.getOwnPropertyDescriptor(second, key);
		return left && right && 'value' in left && 'value' in right && sameData(left.value, right.value);
	});
}

/** Compare validated JSON data without invoking accessors or accepting opaque object equivalence. */
function sameData(first: unknown, second: unknown, depth = 0): boolean {
	if (Object.is(first, second)) return true;
	if (depth > 64 || !first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
	if (Array.isArray(first) !== Array.isArray(second)) return false;
	if (Array.isArray(first) && Array.isArray(second)) {
		if (first.length !== second.length) return false;
	} else if (![Object.prototype, null].includes(Object.getPrototypeOf(first))
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(second))) return false;
	const keys = Object.keys(first);
	return keys.length === Object.keys(second).length && keys.every(key => {
		const left = Object.getOwnPropertyDescriptor(first, key), right = Object.getOwnPropertyDescriptor(second, key);
		return left && right && 'value' in left && 'value' in right && sameData(left.value, right.value, depth + 1);
	});
}

function data(record: unknown, key: string): unknown {
	if (!record || typeof record !== 'object') return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function selectedIds(value: unknown, available: ReadonlySet<string>): readonly string[] {
	return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && available.has(id)) : [];
}
function frame(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
