/* SPDX-License-Identifier: AGPL-3.0-only */
import { recordingTrackRoute, setRecordingTrackRoute, type RecordingRouting, type RecordingRoute } from '../../../recording-routing.js';

interface Track { readonly id: string; readonly type?: string }
interface RecordingRouteHistoryPort {
	getRouting(): RecordingRouting;
	setRouting(routing: RecordingRouting): void;
	reconcile(tracks: readonly Track[]): boolean;
	readonly signal?: AbortSignal;
}

/** Deleted inputs do not reserve channels; Undo can reclaim an otherwise free assignment. */
export function createRecordingRouteHistory(port: RecordingRouteHistoryPort) {
	const retired = new Map<string, RecordingRoute>();
	let present = new Set<string>();
	let activation: number | undefined;
	const clear = () => { retired.clear(); present.clear(); activation = undefined; };
	port.signal?.addEventListener('abort', clear, { once: true });
	return (tracks: readonly Track[], generation?: number): boolean => {
		if (generation === undefined || port.signal?.aborted) { clear(); return port.reconcile(tracks); }
		if (activation !== generation) { clear(); activation = generation; }
		const nextIds = new Set(tracks.map(track => track.id));
		for (const [id, route] of Object.entries(port.getRouting().routes)) {
			if (!nextIds.has(id)) retired.set(id, route);
		}
		let changed = port.reconcile(tracks);
		let routing = port.getRouting();
		for (const track of tracks) {
			const route = retired.get(track.id);
			if (!route || present.has(track.id)) continue;
			retired.delete(track.id);
			if (recordingTrackRoute(routing.routes, track.id)) continue;
			try {
				routing = setRecordingTrackRoute(routing, track, route);
				changed = true;
			} catch (error) {
				// A new surviving assignment owns its channel. Restoring document
				// history cannot silently steal that user's current hardware input.
				if (!(error instanceof RangeError)) throw error;
			}
		}
		present = nextIds;
		if (changed) port.setRouting(routing);
		return changed;
	};
}
