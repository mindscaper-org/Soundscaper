/* SPDX-License-Identifier: AGPL-3.0-only */
import { soundscaperAudioTrackFreezeRequirementId } from './editor-project-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';

/** The current track's frozen render does not describe an inactive arrangement. */
export function prepareSoundscaperPlaylistValidation(project: Record<string, unknown>, trackId: string): void {
	const tracks = project.tracks as Record<string, unknown>[];
	const track = tracks.find(track => track.id === trackId);
	if (!track || !Object.hasOwn(track, 'audioFreeze')) return;
	delete track.audioFreeze;
	const manifest = project.featureRequirements as ProjectFeatureRequirementsManifest;
	const id = soundscaperAudioTrackFreezeRequirementId(trackId);
	project.featureRequirements = { ...manifest, requirements: manifest.requirements.filter(requirement => requirement.id !== id) };
}
