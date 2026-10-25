/* SPDX-License-Identifier: AGPL-3.0-only */

import { frozenRecordIdIndex, hasOwnDataValue } from '../frozen-record-id-index.ts';
import { requireClip } from './shared-runtime.js';

/** Prepare one command against immutable clip identities; mutable inputs keep live scans. */
export function createFrozenClipReader<Clip extends { readonly id: string }>(
	project: { readonly clips: readonly Clip[] },
): (id: string) => Clip {
	const fallback = (id: string): Clip => requireClip(project, id) as Clip;
	const descriptor = Object.getOwnPropertyDescriptor(project, 'clips');
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fallback;
	const clips = descriptor.value as unknown;
	if (!Array.isArray(clips)) return fallback;
	const index = frozenRecordIdIndex(clips as Clip[]);
	if (!index) return fallback;
	return id => {
		// An ID factory can replace the project collection while preparing a command.
		if (!hasOwnDataValue(project, 'clips', clips)) return fallback(id);
		const clip = index.get(id);
		if (!clip) throw new ReferenceError(`Unknown clip: ${id}.`);
		return clip;
	};
}
