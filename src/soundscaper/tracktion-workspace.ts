/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TRACKTION_TRACK_PAGE_SIZE, type TracktionClipPage, type TracktionClipView, type TracktionEditResult, type TracktionIndexedClip,
	type TracktionProjectBridge, type TracktionOpenedProject, type TracktionProjectPage, type TracktionTrackView,
} from './tracktion-project-contract.ts';

export interface TracktionWorkspace extends TracktionOpenedProject {
	readonly tracks: readonly TracktionTrackView[];
	readonly selectedTrack: TracktionTrackView | undefined;
	readonly clips: readonly TracktionClipView[];
	readonly previousSelection: Readonly<{ trackId: string; clips: readonly TracktionClipView[] }> | undefined;
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

export async function readTracktionWorkspaceAfterClipEdit(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, result: TracktionEditResult,
	{ trackId = workspace.selectedTrack?.id, removedFromSource }: Readonly<{ trackId?: string; removedFromSource?: string }> = {},
): Promise<TracktionWorkspace> {
	const { sessionId, selectedTrack: source } = workspace;
	const { revision, importedClip, trimmedClip } = result;
	const placement = importedClip ?? trimmedClip;
	if (placement && source && source.id === trackId && (!importedClip || importedClip.clip.id === result.itemId)) {
		const clips = placeEditedClip(workspace.clips, placement, importedClip !== undefined);
		if (clips) {
			const selectedTrack = withClipCount(source, clips.length);
			const changedTrack = selectedTrack === source ? undefined : selectedTrack;
			const project = projectWithEdit(workspace, result, changedTrack);
			const tracks = changedTrack ? replaceTrack(workspace.tracks, changedTrack) : workspace.tracks;
			if (project) return { ...workspace, project, tracks, selectedTrack, clips };
		}
	}
	const target = source?.id === trackId ? source : workspace.tracks.find((track) => track.id === trackId);
	const sourceClips = removedFromSource ? workspace.clips.filter((clip) => clip.id !== removedFromSource) : workspace.clips;
	const localRemoval = removedFromSource && target && target === source ? withClipCount(target, sourceClips.length) : undefined;
	const localProject = localRemoval && projectWithEdit(workspace, result, localRemoval);
	const project = localProject ?? await bridge.request({ kind: 'project', sessionId, offset: 0 });
	if (project.revision !== revision || !target) return await readWorkspaceFromPage(bridge, workspace, project, trackId);
	const current = project.tracks.find((track) => track.id === target.id);
	const clips = localRemoval ? sourceClips
		: current?.clipCount === 0 ? [] : await readTracktionClips(bridge, sessionId, revision, target.id);
	const selectedTrack = localRemoval ?? withClipCount(target, clips.length);
	let previousSelection = workspace.previousSelection;
	let previousTrack = source;
	if (source && source.id !== target.id) {
		previousSelection = { trackId: source.id, clips: sourceClips };
		previousTrack = withClipCount(source, sourceClips.length);
	}
	const tracks = selectedTrack === target && previousTrack === source ? workspace.tracks : workspace.tracks.map((track) => {
		if (track.id === selectedTrack.id) return selectedTrack;
		return track.id === previousTrack?.id ? previousTrack : track;
	});
	return { ...workspace, project, tracks, selectedTrack, clips, previousSelection };
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

function projectWithEdit(workspace: TracktionWorkspace, { revision, history }: TracktionEditResult, updatedTrack?: TracktionTrackView) {
	if (!history || revision !== workspace.project.revision + 1) return undefined;
	const { tracks } = workspace.project;
	return { ...workspace.project, ...history, revision,
		tracks: updatedTrack ? replaceTrack(tracks, updatedTrack) : tracks };
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
	const previousSelection = previous && { trackId: previous.id, clips: workspace.clips };
	return { ...workspace, project: firstPage, tracks, selectedTrack, clips, previousSelection };
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
	return { sessionId, name: project.name, project: firstPage, tracks, selectedTrack, clips, previousSelection: undefined };
}

export async function readTracktionClips(
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
