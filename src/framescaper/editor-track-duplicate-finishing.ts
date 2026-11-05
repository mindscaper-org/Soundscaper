/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSplitVisualPresentationPlanner } from './editor-split-visual-presentations.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing-validation.ts';

/** Duplicate Track carries its exact old/new track identities through the inherited command. */
export function inheritDuplicatedTrackFinishing(
	previous: FramescaperProjectFinishing,
	applied: Record<string, unknown>,
	command: unknown,
): void {
	const copies = createSplitVisualPresentationPlanner(applied.videoVisualPresentations as readonly unknown[]);
	const added: unknown[] = [];
	visit(command);
	if (added.length) applied.videoVisualPresentations = [...applied.videoVisualPresentations as readonly unknown[], ...added];

	function visit(value: unknown): void {
		if (!value || typeof value !== 'object' || !('type' in value)) return;
		if (value.type === 'batch' && 'commands' in value && Array.isArray(value.commands)) {
			for (const child of value.commands) visit(child);
			return;
		}
		if (value.type !== 'track/add' || !('productionDuplicate' in value) || !('track' in value)) return;
		const duplicate = record(value.productionDuplicate);
		const source = records(previous.tracks).find(track => track.id === duplicate.sourceTrackId);
		const target = records(applied.tracks).find(track => track.id === record(value.track).id);
		if (source?.type !== 'video' || target?.type !== 'video') return;
		const originalIds = Array.isArray(source.clipIds) ? source.clipIds as readonly string[] : [];
		const copiedIds = Array.isArray(target.clipIds) ? target.clipIds as readonly string[] : [];
		if (originalIds.length !== copiedIds.length) throw new RangeError('Duplicate Track must retain every picture clip.');
		for (let index = 0; index < originalIds.length; index += 1) {
			for (const copy of copies.copy(originalIds[index]!, copiedIds[index]!)) added.push(copy.presentation);
		}
	}
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Track duplication must carry its identities.');
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError('Track duplication requires the admitted track inventory.');
	return value.map(record);
}
