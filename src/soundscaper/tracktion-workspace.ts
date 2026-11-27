/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TracktionClipPage, TracktionClipView, TracktionProjectBridge, TracktionOpenedProject, TracktionProjectPage, TracktionTrackView,
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
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, revision: number,
): Promise<TracktionWorkspace> {
	if (revision === workspace.project.revision) return workspace;
	const { sessionId, selectedTrack } = workspace;
	const project = await bridge.request({ kind: 'project', sessionId, offset: 0 });
	if (project.revision !== revision) return await readWorkspaceFromPage(bridge, workspace, project, selectedTrack?.id);
	return { ...workspace, project };
}

export async function readTracktionWorkspaceAfterClipEdit(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, revision: number,
	{ trackId = workspace.selectedTrack?.id, removedFromSource }: Readonly<{ trackId?: string; removedFromSource?: string }> = {},
): Promise<TracktionWorkspace> {
	const { sessionId, selectedTrack: source } = workspace;
	const project = await bridge.request({ kind: 'project', sessionId, offset: 0 });
	const target = source?.id === trackId ? source : workspace.tracks.find((track) => track.id === trackId);
	if (project.revision !== revision || !target) return await readWorkspaceFromPage(bridge, workspace, project, trackId);
	const current = project.tracks.find((track) => track.id === target.id);
	const sourceClips = removedFromSource ? workspace.clips.filter((clip) => clip.id !== removedFromSource) : workspace.clips;
	const clips = removedFromSource && target === source ? sourceClips
		: current?.clipCount === 0 ? [] : await readTracktionClips(bridge, sessionId, revision, target.id);
	const selectedTrack = withClipCount(target, clips.length);
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

function withClipCount(track: TracktionTrackView, clipCount: number): TracktionTrackView {
	return track.clipCount === clipCount ? track : { ...track, clipCount };
}

export async function readTracktionWorkspaceAfterAddingTrack(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, revision: number, added: TracktionTrackView,
): Promise<TracktionWorkspace> {
	const project = await bridge.request({ kind: 'project', sessionId: workspace.sessionId, offset: 0 });
	if (project.revision !== revision) return await readWorkspaceFromPage(bridge, workspace, project, added.id);
	const tracks = project.nextOffset === null ? project.tracks : [...workspace.tracks, added];
	const selectedTrack = tracks.at(-1);
	if (selectedTrack?.id !== added.id || selectedTrack.clipCount !== 0) {
		return await readWorkspaceFromPage(bridge, workspace, project, added.id);
	}
	const previousSelection = workspace.selectedTrack && { trackId: workspace.selectedTrack.id, clips: workspace.clips };
	return { ...workspace, project, tracks, selectedTrack, clips: [], previousSelection };
}

export async function readTracktionWorkspaceAfterTrackDuplication(
	bridge: TracktionProjectBridge, workspace: TracktionWorkspace, revision: number, sourceId: string, duplicateId: string,
): Promise<TracktionWorkspace> {
	const { sessionId, selectedTrack: previous } = workspace;
	const project = await bridge.request({ kind: 'project', sessionId, offset: 0 });
	// Tracktion duplicates an audio track immediately after its source.
	const index = workspace.tracks.findIndex((track) => track.id === sourceId) + 1;
	if (project.revision !== revision || index === 0) return await readWorkspaceFromPage(bridge, workspace, project, duplicateId);
	let selectedTrack = project.tracks[index];
	if (!selectedTrack && project.nextOffset !== null) {
		const page = await bridge.request({ kind: 'project', sessionId, offset: index });
		if (page.revision !== revision) return await readTracktionWorkspace(bridge, workspace, duplicateId);
		selectedTrack = page.tracks[0];
	}
	if (selectedTrack?.id !== duplicateId) return await readWorkspaceFromPage(bridge, workspace, project, duplicateId);
	let tracks = project.tracks;
	if (project.nextOffset !== null) {
		const updatedTracks = workspace.tracks.slice();
		updatedTracks.splice(index, 0, selectedTrack);
		tracks = updatedTracks;
	}
	const clips = selectedTrack.clipCount ? await readTracktionClips(bridge, sessionId, revision, duplicateId) : [];
	const previousSelection = previous && { trackId: previous.id, clips: workspace.clips };
	return { ...workspace, project, tracks, selectedTrack, clips, previousSelection };
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
