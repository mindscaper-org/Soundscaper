/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TracktionClipPage, TracktionClipView, TracktionDesktopBridge, TracktionOpenedProject, TracktionTrackView,
} from './tracktion-project-contract.ts';

export interface TracktionWorkspace extends TracktionOpenedProject {
	readonly tracks: readonly TracktionTrackView[];
	readonly selectedTrack: TracktionTrackView | undefined;
	readonly clips: readonly TracktionClipView[];
}

export async function readTracktionWorkspace(
	bridge: TracktionDesktopBridge,
	project: Pick<TracktionOpenedProject, 'sessionId' | 'name'>,
	selectedTrackId?: string,
): Promise<TracktionWorkspace> {
	const { sessionId } = project;
	const firstPage = await bridge.request({ kind: 'project', sessionId, offset: 0 });
	const tracks = [...firstPage.tracks];
	for (let offset = firstPage.nextOffset; offset !== null;) {
		const page = await bridge.request({ kind: 'project', sessionId, offset });
		if (page.revision !== firstPage.revision) throw new Error('The Tracktion project changed while reading tracks.');
		tracks.push(...page.tracks);
		offset = page.nextOffset;
	}
	const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? tracks[0];
	const clips: TracktionClipView[] = [];
	if (selectedTrack) {
		for (let offset: number | null = 0; offset !== null;) {
			const page: TracktionClipPage = await bridge.request({
				kind: 'clips', sessionId, revision: firstPage.revision, trackId: selectedTrack.id, offset,
			});
			clips.push(...page.clips);
			offset = page.nextOffset;
		}
	}
	return { sessionId, name: project.name, project: firstPage, tracks, selectedTrack, clips };
}
