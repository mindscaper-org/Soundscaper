/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TRACKTION_TRACK_PAGE_SIZE, type TracktionClipPage, type TracktionClipView, type TracktionEditResult, type TracktionIndexedClip,
	type TracktionProjectBridge, type TracktionOpenedProject, type TracktionProjectPage, type TracktionTrackView,
} from './tracktion-project-contract.ts';

const RECENT_CLIP_TRACK_LIMIT = 4;

export interface TracktionWorkspace extends TracktionOpenedProject {
	readonly tracks: readonly TracktionTrackView[];
	readonly selectedTrack: TracktionTrackView | undefined;
	readonly clips: readonly TracktionClipView[];
	readonly recentClips: readonly Readonly<{ trackId: string; clips: readonly TracktionClipView[] }>[];
}

export async function readTracktionWorkspace(
	bridge: TracktionProjectBridge,
	project: Pick<TracktionOpenedProject, 'sessionId' | 'name'>,
	selectedTrackId?: string,
): Promise<TracktionWorkspace> {
	const firstPage = await bridge.request({ kind: 'project', sessionId: project.sessionId, offset: 0 });
	return await readWorkspaceFromPage(bridge, project, firstPage, selectedTrackId);
}

export function readOpenedTracktionWorkspace(bridge: TracktionProjectBridge, project: TracktionOpenedProject): Promise<TracktionWorkspace> {
	return readWorkspaceFromPage(bridge, project, project.project);
}

export async function readTracktionWorkspaceAfterSelection(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, selectedTrack: TracktionTrackView,
): Promise<TracktionWorkspace> {
	const cached = workspace.recentClips.find(({ trackId }) => trackId === selectedTrack.id);
	const clips = cached?.clips ?? (selectedTrack.clipCount
		? await readTracktionClips(bridge, workspace.sessionId, workspace.project.revision, selectedTrack.id) : []);
	return { ...workspace, selectedTrack, clips, recentClips: rememberSelectedClips(workspace, selectedTrack) };
}

function rememberSelectedClips(workspace: TracktionWorkspace, nextTrack: TracktionTrackView, clips = workspace.clips) {
	const recent = workspace.recentClips.filter(({ trackId }) => trackId !== nextTrack.id);
	if (workspace.selectedTrack && clips.length) recent.unshift({ trackId: workspace.selectedTrack.id, clips });
	return limitRecentClips(recent, nextTrack);
}

function limitRecentClips(recent: TracktionWorkspace['recentClips'], nextTrack: TracktionTrackView) {
	const limit = nextTrack.clipCount === 0 ? RECENT_CLIP_TRACK_LIMIT : RECENT_CLIP_TRACK_LIMIT - 1;
	return recent.length > limit ? recent.slice(0, limit) : recent;
}

export async function readTracktionWorkspaceWithCachedTracks(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, result: TracktionEditResult,
): Promise<TracktionWorkspace> {
	const { revision } = result;
	if (revision === workspace.project.revision) return workspace;
	const { sessionId, selectedTrack } = workspace;
	const project = projectWithEdit(workspace, result) ?? await bridge.request({ kind: 'project', sessionId, offset: 0 });
	if (project.revision !== revision) return await readWorkspaceFromPage(bridge, workspace, project, selectedTrack?.id);
	return { ...workspace, project };
}

export async function readTracktionWorkspaceAfterHistoryEdit(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, result: TracktionEditResult,
): Promise<TracktionWorkspace> {
	const project = result.timelineUnchanged === true ? projectWithEdit(workspace, result) : undefined;
	return project ? { ...workspace, project } : await readTracktionWorkspace(bridge, workspace, workspace.selectedTrack?.id);
}

export async function readTracktionWorkspaceAfterClipEdit(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, result: TracktionEditResult,
	{ trackId = workspace.selectedTrack?.id, removedFromSource }: Readonly<{ trackId?: string; removedFromSource?: string }> = {},
): Promise<TracktionWorkspace> {
	const { sessionId, selectedTrack: source } = workspace;
	const { revision } = result;
	const target = source?.id === trackId ? source : workspace.tracks.find((track) => track.id === trackId);
	const sourceClips = removedFromSource ? workspace.clips.filter((clip) => clip.id !== removedFromSource) : workspace.clips;
	const knownRemoval = removedFromSource && target === source ? sourceClips : undefined;
	const localProject = target && projectWithEdit(workspace, result);
	if (target && localProject) {
		const localClips = target === source ? knownRemoval ?? applyClipPlacements(workspace.clips, result)
			: applyPlacementToDestination(workspace, target, result, removedFromSource, sourceClips);
		if (localClips) return workspaceWithClipRows(workspace, localProject, target, localClips, sourceClips, true);
	}
	const project = await bridge.request({ kind: 'project', sessionId, offset: 0 });
	if (project.revision !== revision || !target) return await readWorkspaceFromPage(bridge, workspace, project, trackId);
	const current = project.tracks.find((track) => track.id === target.id);
	const clips = knownRemoval ?? (current?.clipCount === 0 ? [] : await readTracktionClips(bridge, sessionId, revision, target.id));
	return workspaceWithClipRows(workspace, project, target, clips, sourceClips, false);
}

function applyPlacementToDestination(
	workspace: TracktionWorkspace, target: TracktionTrackView, result: TracktionEditResult,
	removedFromSource: string | undefined, sourceClips: readonly TracktionClipView[],
): readonly TracktionClipView[] | undefined {
	const { placedClip, itemId } = result;
	if (!workspace.selectedTrack || !placedClip || placedClip.clip.id !== (itemId ?? removedFromSource)) return undefined;
	if (removedFromSource && sourceClips.length !== workspace.clips.length - 1) return undefined;
	const destinationClips = target.clipCount === 0 ? [] : workspace.recentClips.find(({ trackId }) => trackId === target.id)?.clips;
	if (destinationClips?.length !== target.clipCount) return undefined;
	return placeEditedClip(destinationClips, placedClip, true);
}

function workspaceWithClipRows(
	workspace: TracktionWorkspace, project: TracktionProjectPage, target: TracktionTrackView,
	clips: readonly TracktionClipView[], sourceClips: readonly TracktionClipView[], patchProject: boolean,
): TracktionWorkspace {
	const { selectedTrack: source } = workspace;
	const selectedTrack = withClipCount(target, clips.length);
	const changesSelection = source && source.id !== target.id;
	const recentClips = changesSelection ? rememberSelectedClips(workspace, selectedTrack, sourceClips)
		: limitRecentClips(workspace.recentClips, selectedTrack);
	const previousTrack = changesSelection ? withClipCount(source, sourceClips.length) : source;
	const tracks = selectedTrack === target && previousTrack === source ? workspace.tracks : workspace.tracks.map((track) => {
		if (track.id === selectedTrack.id) return selectedTrack;
		return track.id === previousTrack?.id ? previousTrack : track;
	});
	let pageTracks = project.tracks;
	if (patchProject && selectedTrack !== target) pageTracks = replaceTrack(pageTracks, selectedTrack);
	if (patchProject && previousTrack && previousTrack !== source) pageTracks = replaceTrack(pageTracks, previousTrack);
	return { ...workspace, project: pageTracks === project.tracks ? project : { ...project, tracks: pageTracks },
		tracks, selectedTrack, clips, recentClips };
}

function applyClipPlacements(clips: readonly TracktionClipView[], result: TracktionEditResult): readonly TracktionClipView[] | undefined {
	const { splitClips, importedClip, recordedClip, trimmedClip, placedClip, removedClipIds, pastedClips, itemId } = result;
	if (pastedClips) return insertPastedClips(clips, pastedClips);
	if (removedClipIds) {
		const removed = new Set(removedClipIds);
		const remaining = clips.filter(({ id }) => !removed.has(id));
		return removed.size === removedClipIds.length && remaining.length + removed.size === clips.length ? remaining : undefined;
	}
	if (splitClips) {
		const { left, right } = splitClips;
		if (right.clip.id !== itemId) return undefined;
		const [first, second] = left.index < right.index ? [left, right] : [right, left];
		if (first.index < 0 || first.index === second.index || second.index > clips.length) return undefined;
		const previous = clips.findIndex(({ id }) => id === left.clip.id);
		if (previous < 0 || clips.some(({ id }) => id === right.clip.id)) return undefined;
		const updated = clips.slice();
		updated.splice(previous, 1);
		updated.splice(first.index, 0, first.clip);
		updated.splice(second.index, 0, second.clip);
		return updated;
	}
	const inserted = importedClip ?? recordedClip ?? (itemId === null ? undefined : placedClip);
	const placement = inserted ?? trimmedClip ?? placedClip;
	if (!placement || inserted && inserted.clip.id !== itemId) return undefined;
	return placeEditedClip(clips, placement, inserted !== undefined);
}

function insertPastedClips(clips: readonly TracktionClipView[], placements: readonly TracktionIndexedClip[]) {
	const ids = new Set(clips.map(({ id }) => id));
	const updated = clips.slice();
	let previous = -1;
	for (const { clip, index } of placements) {
		if (!Number.isSafeInteger(index) || index <= previous || index > updated.length || ids.has(clip.id)) return undefined;
		updated.splice(index, 0, clip);
		ids.add(clip.id);
		previous = index;
	}
	return updated;
}

function placeEditedClip(
	clips: readonly TracktionClipView[], { clip, index }: TracktionIndexedClip, inserting: boolean,
): readonly TracktionClipView[] | undefined {
	if (index < 0 || index > clips.length || (!inserting && index === clips.length)) return undefined;
	const previousIndex = clips.findIndex(({ id }) => id === clip.id);
	if ((previousIndex === -1) !== inserting) return undefined;
	const updated = clips.slice();
	if (!inserting) updated.splice(previousIndex, 1);
	updated.splice(index, 0, clip);
	return updated;
}

function projectWithEdit(workspace: TracktionWorkspace, { revision, history }: TracktionEditResult) {
	if (!history || revision !== workspace.project.revision + 1) return undefined;
	return { ...workspace.project, ...history, revision };
}

function replaceTrack(tracks: readonly TracktionTrackView[], track: TracktionTrackView): readonly TracktionTrackView[] {
	const index = tracks.findIndex(({ id }) => id === track.id);
	if (index === -1) return tracks;
	const updated = tracks.slice();
	updated[index] = track;
	return updated;
}

function withClipCount(track: TracktionTrackView, clipCount: number): TracktionTrackView {
	return track.clipCount === clipCount ? track : { ...track, clipCount };
}

export async function readTracktionWorkspaceAfterTrackInsertion(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, result: TracktionEditResult,
): Promise<TracktionWorkspace> {
	const { sessionId, selectedTrack: previous } = workspace;
	const { insertion, itemId, revision } = result;
	const project = projectWithEdit(workspace, result);
	if (!project || !insertion || insertion.track.id !== itemId || insertion.index < 0 || insertion.index > workspace.tracks.length) {
		return await readTracktionWorkspace(bridge, workspace, itemId ?? previous?.id);
	}
	const { index, track: selectedTrack } = insertion;
	const tracks = workspace.tracks.slice();
	tracks.splice(index, 0, selectedTrack);
	const nextOffset = tracks.length > TRACKTION_TRACK_PAGE_SIZE ? TRACKTION_TRACK_PAGE_SIZE : null;
	const firstPage = { ...project, nextOffset, tracks: nextOffset === null ? tracks : tracks.slice(0, nextOffset) };
	const clips = selectedTrack.clipCount ? await readTracktionClips(bridge, sessionId, revision, selectedTrack.id) : [];
	const recentClips = rememberSelectedClips(workspace, selectedTrack);
	return { ...workspace, project: firstPage, tracks, selectedTrack, clips, recentClips };
}

async function readWorkspaceFromPage(
	bridge: TracktionProjectBridge,
	project: Pick<TracktionOpenedProject, 'sessionId' | 'name'>,
	firstPage: TracktionProjectPage,
	selectedTrackId?: string,
): Promise<TracktionWorkspace> {
	const { sessionId } = project;
	const tracks = [...firstPage.tracks];
	for (let offset = firstPage.nextOffset; offset !== null;) {
		const page = await bridge.request({ kind: 'project', sessionId, offset });
		if (page.revision !== firstPage.revision) throw new Error('The Tracktion project changed while reading tracks.');
		tracks.push(...page.tracks);
		offset = page.nextOffset;
	}
	const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? tracks[0];
	const clips = selectedTrack?.clipCount ? await readTracktionClips(bridge, sessionId, firstPage.revision, selectedTrack.id) : [];
	return { sessionId, name: project.name, project: firstPage, tracks, selectedTrack, clips, recentClips: [] };
}

async function readTracktionClips(
	bridge: TracktionProjectBridge, sessionId: string, revision: number, trackId: string,
): Promise<readonly TracktionClipView[]> {
	const clips: TracktionClipView[] = [];
	for (let offset: number | null = 0; offset !== null;) {
		const page: TracktionClipPage = await bridge.request({ kind: 'clips', sessionId, revision, trackId, offset });
		clips.push(...page.clips);
		offset = page.nextOffset;
	}
	return clips;
}
