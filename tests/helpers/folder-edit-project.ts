/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../../src/common/editor/project-media-factory.ts';

export function folderEditProject() {
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'folder-edits', sources: [source], primarySequenceId: 'main',
		trackFolders: [{ id: 'dialogue', name: 'Dialogue', collapsed: true }, { id: 'room', name: 'Room', collapsed: true }],
		tracks: ['voice', 'ambience', 'music'].map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-first`, `${id}-later`] })),
		clips: ['voice', 'ambience', 'music'].flatMap(id => [0, 144_000].map((start, index) => createAudioClip({
			id: `${id}-${index ? 'later' : 'first'}`, title: `${id} ${index ? 'later' : 'first'}`, sourceId: source.id,
			timelineStartFrame: start, durationFrames: 48_000, sourceDurationFrames: 48_000,
		}))),
		sequences: [{ id: 'main', trackNodes: [
			{ kind: 'folder', id: 'dialogue', parentFolderId: null },
			{ kind: 'track', id: 'voice', parentFolderId: 'dialogue' },
			{ kind: 'folder', id: 'room', parentFolderId: 'dialogue' },
			{ kind: 'track', id: 'ambience', parentFolderId: 'room' },
			{ kind: 'track', id: 'music', parentFolderId: null },
		] }],
	});
	return { project, source };
}
