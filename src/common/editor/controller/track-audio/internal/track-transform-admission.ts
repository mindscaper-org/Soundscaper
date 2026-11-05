/* SPDX-License-Identifier: AGPL-3.0-only */
import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { hasCoreEditingProjectAuthority } from '../../../project-schema-version.ts';
import { findControllerTrack, type ControllerProject, type ControllerTrack } from '../track-domain-types.ts';

/** Refuse unavailable track transforms before acquiring or publishing replacement media. */
export function requireWritableAudioTransformTrack(
	project: ControllerProject, trackId: string | null,
	copy: Readonly<{ v2Required: string; audioTrackRequired: string }>,
): ControllerTrack {
	if (!hasCoreEditingProjectAuthority(project)) throw createLocalizedError(Error, copy, 'v2Required');
	const track = findControllerTrack(project, trackId);
	if (!track || track.type !== 'audio') throw createLocalizedError(Error, copy, 'audioTrackRequired');
	if (track.locked) throw new RangeError(`Track ${track.id} is locked.`);
	return track;
}
