/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';

/** Give the menu reference matrix a valid two-microphone selection with separate clip identities. */
export function withSecondMicrophoneForMenuReference(project: SoundscaperProject) {
	const clip = project.clips.find(candidate => candidate.kind === 'audio');
	if (!clip) throw new Error('The microphone menu fixture requires an audio clip.');
	return { ...project,
		clips: [...project.clips, { ...clip, id: 'second-voice-clip' }],
		tracks: [...project.tracks, createAudioTrack({ id: 'second-voice', name: 'Second voice', clipIds: ['second-voice-clip'] })],
		selection: { startFrame: 0, endFrame: 48000, trackIds: ['voice-track', 'second-voice'], clipIds: [] },
	};
}
