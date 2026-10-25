/* SPDX-License-Identifier: AGPL-3.0-only */

import { frozenRecordIdIndex, hasOwnDataValue } from '../frozen-record-id-index.ts';
import { requireClip } from './shared-runtime.js';

/** Prepare one command against immutable identities after its first eight live reads. */
export function createFrozenClipReader<Clip extends { readonly id: string }>(
	project: { readonly clips: readonly Clip[] },
): (id: string) => Clip {
	const fallback = (id: string): Clip => requireClip(project, id) as Clip;
	let reads = 0, prepared = false;
	let clips: readonly Clip[] | null = null;
	let index: ReadonlyMap<string, Clip> | null = null;
	return id => {
		// Small targets keep short-circuit searches instead of preparing the entire project.
		if (++reads <= 8) return fallback(id);
		if (!prepared) {
			prepared = true;
			const descriptor = Object.getOwnPropertyDescriptor(project, 'clips');
			if (descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value)) {
				clips = descriptor.value as Clip[];
				index = frozenRecordIdIndex(clips);
			}
		}
		// An ID factory can replace the collection while preparing a command.
		if (!index || !hasOwnDataValue(project, 'clips', clips)) return fallback(id);
		const clip = index.get(id);
		if (!clip) throw new ReferenceError(`Unknown clip: ${id}.`);
		return clip;
	};
}
