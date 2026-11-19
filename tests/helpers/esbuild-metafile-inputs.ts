/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Metafile } from 'esbuild';

/** Compiler attributes identify a separate module instance, not part of its physical source filename. */
export function physicalEsbuildInputPaths(metafile: Pick<Metafile, 'inputs'>): string[] {
	return Object.entries(metafile.inputs).map(([key, input]) => {
		if (input.with === undefined) return key;
		const attributes = Object.entries(input.with);
		if (attributes.length !== 1 || attributes[0]?.[0] !== 'type' || attributes[0][1] !== 'json') {
			throw new TypeError('Physical input admission requires exact supported JSON attributes.');
		}
		const suffix = " with { type: 'json' }";
		const path = key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
		if (!path.endsWith('.json')) throw new TypeError('Attributed JSON input must name its physical JSON file.');
		return path;
	});
}
