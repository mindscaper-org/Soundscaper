/* SPDX-License-Identifier: AGPL-3.0-only */
import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { readTrackPlaylists } from '../../../track-playlists.ts';
import { assertTakeCompChannelRewriteAllowed } from './take-comp-channel-rewrite-admission.ts';

/** Channel extraction cannot discard the track's independently retained arrangements. */
export function assertTrackChannelRewriteAllowed(project: Readonly<Record<string, unknown>>, trackIds: readonly string[], copy: object): void {
	assertTakeCompChannelRewriteAllowed(project, trackIds, copy);
	const selected = new Set(trackIds);
	if (readTrackPlaylists(project).some(collection => selected.has(collection.trackId))) {
		throw createLocalizedError(Error, copy, 'trackPlaylistsBeforeChannelRewrite', undefined, {
			fallback: 'Save a session snapshot and remove the track’s playlists before splitting or merging its channels.',
		});
	}
}
