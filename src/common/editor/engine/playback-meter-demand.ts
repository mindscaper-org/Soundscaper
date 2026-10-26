/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalStripRefKey, type StripRef } from '../parameter-address.ts';

interface MeterDemand {
	active: boolean;
	readonly leases: Map<string, number>;
}

const demands = new WeakMap<object, MeterDemand>();

/** Opt the editor into visibility leases; headless consumers keep full meters. */
export function enablePlaybackMeterDemand(owner: object): void {
	if (!demands.has(owner)) demands.set(owner, { active: false, leases: new Map() });
}

export function clearPlaybackMeterDemand(owner: object): void {
	demands.delete(owner);
}

/** A mounted observer also opts in when its first visibility report is hidden. */
export function activatePlaybackMeterDemand(owner: object): void {
	const demand = demands.get(owner);
	if (demand) demand.active = true;
}

/** Multiple timeline/mixer views can independently hold the same strip. */
export function acquirePlaybackMeterDemand(owner: object, strip: StripRef): () => void {
	const demand = demands.get(owner);
	if (!demand) return () => {};
	const key = canonicalStripRefKey(strip);
	demand.active = true;
	demand.leases.set(key, (demand.leases.get(key) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (demand.leases.get(key) ?? 1) - 1;
		if (remaining) demand.leases.set(key, remaining);
		else demand.leases.delete(key);
	};
}

/** Master analysis and explicitly armed tracks remain independent of scrolling. */
export function readPlaybackMeterDemand(owner: object, project: unknown): ReadonlySet<string> | null {
	const demand = demands.get(owner);
	if (!demand?.active) return null;
	const keys = new Set(demand.leases.keys());
	keys.add(canonicalStripRefKey({ kind: 'master' }));
	const tracks: unknown = project && typeof project === 'object' && 'tracks' in project ? project.tracks : null;
	if (Array.isArray(tracks)) for (const track of tracks as unknown[]) {
		if (track && typeof track === 'object' && 'armed' in track && track.armed === true
			&& 'id' in track && typeof track.id === 'string') {
			keys.add(canonicalStripRefKey({ kind: 'track', id: track.id }));
		}
	}
	return keys;
}
