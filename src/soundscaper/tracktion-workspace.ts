/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TracktionClipPage, TracktionClipView, TracktionProjectBridge, TracktionOpenedProject, TracktionProjectPage, TracktionTrackView,
} from './tracktion-project-contract.ts';

export interface TracktionWorkspace extends TracktionOpenedProject {
	readonly tracks: readonly TracktionTrackView[];
	readonly selectedTrack: TracktionTrackView | undefined;
	readonly clips: readonly TracktionClipView[];
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
	const clips = selectedTrack ? await readTracktionClips(bridge, sessionId, firstPage.revision, selectedTrack.id) : [];
	return { sessionId, name: project.name, project: firstPage, tracks, selectedTrack, clips };
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
