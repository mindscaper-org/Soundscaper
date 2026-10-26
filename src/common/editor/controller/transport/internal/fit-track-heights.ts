/* SPDX-License-Identifier: AGPL-3.0-only */

interface HeightTrack { readonly id: string; readonly height?: number }
interface HeightProject { readonly id?: string; readonly tracks: readonly HeightTrack[] }
interface HeightCommand {
	readonly type: 'track/update'; readonly trackId: string; readonly changes: { readonly height: number };
}
interface Runtime {
	readonly getProject: () => HeightProject | null;
	readonly state: { autoFitTrackHeight: boolean; visibleTrackHeights: Record<string, number> };
	readonly editingBlocked: () => boolean;
	readonly publishProjectState: () => void;
	readonly commit: (command: { readonly type: 'batch'; readonly commands: readonly HeightCommand[] }) => unknown;
}

/** Fit the requested lanes into measured viewport space, freezing other fitted rows in the same edit. */
export function createFitTrackHeights(runtime: Runtime) {
	return (trackIds?: readonly string[], availableHeight?: number): unknown => {
		if (runtime.editingBlocked()) return null;
		const project = runtime.getProject();
		if (!project) return null;
		const targets = new Set(trackIds ?? project.tracks.map(track => track.id));
		const currentHeight = (track: HeightTrack) => Math.max(40,
			Math.round(runtime.state.visibleTrackHeights[track.id] ?? track.height ?? 114));
		const targetCount = project.tracks.filter(track => targets.has(track.id)).length;
		if (targetCount === 0) return project;
		const reserved = project.tracks.filter(track => !targets.has(track.id)).reduce((sum, track) => sum + currentHeight(track), 0);
		const viewport = Number.isFinite(availableHeight) && Number(availableHeight) > 0 ? Number(availableHeight) : reserved + 300 * targetCount;
		const fitted = Math.max(40, Math.floor((viewport - reserved) / targetCount));
		const commands = project.tracks.flatMap((track): HeightCommand[] => {
			const height = targets.has(track.id) ? fitted : currentHeight(track);
			return height === track.height ? [] : [{ type: 'track/update', trackId: track.id, changes: { height } }];
		});
		const result = commands.length ? runtime.commit({ type: 'batch', commands }) : project;
		runtime.state.autoFitTrackHeight = false;
		runtime.publishProjectState();
		return result;
	};
}
