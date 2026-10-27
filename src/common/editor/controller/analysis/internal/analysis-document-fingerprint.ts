/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Generic hosts hash on every read; controller-owned immutable generations retain the exact digest. */
export function createAnalysisDocumentFingerprint(readGeneration?: () => object | null): (project: object) => string {
	const fingerprints = new WeakMap<object, Readonly<{ project: WeakRef<object>; value: string }>>();
	return project => {
		const generation = readGeneration?.() ?? null;
		const retained = generation ? fingerprints.get(generation) : undefined;
		if (retained?.project.deref() === project) return retained.value;
		const value = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(project))));
		if (generation && readGeneration?.() === generation) fingerprints.set(generation, { project: new WeakRef(project), value });
		return value;
	};
}
