/* SPDX-License-Identifier: AGPL-3.0-only */

/** Inactive playlists share track identities; snapshots retain their own complete track graph. */
export function retainedClipEffectRacks(project: unknown): unknown[] {
	const root = record(project), metadata = record(root?.metadata);
	const racks: unknown[] = [];
	const append = (clips: unknown): void => {
		for (const clip of array(clips)) {
			const effects = record(clip)?.effects;
			if (effects !== undefined) racks.push(effects);
		}
	};
	append(root?.clips);
	for (const collection of array(metadata?.trackPlaylists)) {
		for (const playlist of array(record(collection)?.playlists)) append(record(record(playlist)?.state)?.clips);
	}
	return racks;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
