/* SPDX-License-Identifier: AGPL-3.0-only */

export type TrackHeightMode = 'collapse' | 'expand' | 'fit';
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

/** Session-only open heights follow upstream's collapse/expand rule without entering project metadata. */
export function createTrackHeightModeService(runtime: Runtime) {
	const remembered = new Map<string, number>();
	let projectId: string | undefined;
	return (mode: TrackHeightMode, trackIds?: readonly string[], availableHeight?: number): unknown => {
		if (runtime.editingBlocked()) return null;
		const project = runtime.getProject();
		if (!project) return null;
		if (project.id !== projectId) { remembered.clear(); projectId = project.id; }
		const targets = new Set(trackIds ?? project.tracks.map(track => track.id));
		const currentHeight = (track: HeightTrack) => Math.max(40,
			Math.round(runtime.state.visibleTrackHeights[track.id] ?? track.height ?? 114));
		const targetCount = project.tracks.filter(track => targets.has(track.id)).length;
		if (targetCount === 0) return project;
		const reserved = project.tracks.filter(track => !targets.has(track.id)).reduce((sum, track) => sum + currentHeight(track), 0);
		const fitted = Math.max(40, Math.floor(((Number(availableHeight) || 300 * targetCount) - reserved) / targetCount));
		const nextMemory = new Map(remembered);
		const commands = project.tracks.flatMap((track): HeightCommand[] => {
			const current = currentHeight(track);
			let height = current;
			if (targets.has(track.id)) {
				if (mode === 'collapse') {
					if (current > 40) nextMemory.set(track.id, current);
					height = 40;
				} else {
					height = mode === 'fit' ? fitted : current <= 40 ? remembered.get(track.id) ?? 114 : 114;
					nextMemory.delete(track.id);
				}
			}
			return height === track.height ? [] : [{ type: 'track/update', trackId: track.id, changes: { height } }];
		});
		const result = commands.length ? runtime.commit({ type: 'batch', commands }) : project;
		runtime.state.autoFitTrackHeight = false;
		remembered.clear();
		for (const [id, height] of nextMemory) remembered.set(id, height);
		runtime.publishProjectState();
		return result;
	};
}
