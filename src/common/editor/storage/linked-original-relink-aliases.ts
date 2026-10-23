/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LinkedOriginalBinding } from './linked-original-binding.ts';

/** One physical storage key keeps one exact locator while project copies retain their aliases. */
export function linkedOriginalRelinkAliases(
	previous: LinkedOriginalBinding | null,
	replacement: LinkedOriginalBinding,
	aliases: readonly LinkedOriginalBinding[],
	ownedPcm = false,
): readonly LinkedOriginalBinding[] {
	if (!previous) return [];
	if (ownedPcm && contentIdentity(previous) !== contentIdentity(replacement)) {
		throw new Error('The linked original is retained as managed audio. Import the changed file as new media instead.');
	}
	const shared = aliases.filter(alias => alias.projectId !== replacement.projectId || alias.sourceId !== replacement.sourceId);
	if (shared.some(alias => contentIdentity(alias) !== contentIdentity(replacement))) {
		throw new Error('The linked original is shared by another project. Import the changed file as new media instead.');
	}
	return shared;
}

function contentIdentity(binding: LinkedOriginalBinding): string {
	return JSON.stringify([binding.kind, binding.storageKey, binding.mimeType, binding.byteLength, binding.sha256, binding.sourceShape]);
}
