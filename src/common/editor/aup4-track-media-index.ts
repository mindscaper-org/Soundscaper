/* SPDX-License-Identifier: AGPL-3.0-only */

function firstById<Value extends Readonly<{ id: unknown }>>(values: readonly Value[]): ReadonlyMap<unknown, Value> {
	const index = new Map<unknown, Value>();
	for (const value of values) {
		const id = value.id;
		if (!index.has(id)) index.set(id, value);
	}
	return index;
}

/** Invocation-owned lookups shared by every exported track and channel. */
export function createAup4TrackMediaIndex<Clip extends Readonly<{ id: unknown }>, Source extends Readonly<{ id: unknown }>>(
	project: Readonly<{ clips?: readonly Clip[]; sources?: readonly Source[] }>,
) {
	return { clipById: firstById(project.clips ?? []), sourceById: firstById(project.sources ?? []) };
}
