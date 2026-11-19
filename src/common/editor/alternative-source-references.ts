/* SPDX-License-Identifier: AGPL-3.0-only */
import { collectTrackPlaylistSourceIds } from './track-playlist-media.ts';
import { readSessionSnapshots } from './session-snapshots.ts';
import { readSubprojectLinks } from './subprojects.ts';

/** Alternatives and linked proxies retain media independently of live clips. */
export function collectAlternativeSourceIds(project: unknown, target = new Set<string>()): Set<string> {
	collectTrackPlaylistSourceIds(project, target);
	for (const link of readSubprojectLinks(project)) target.add(link.sourceId);
	for (const snapshot of readSessionSnapshots(project)) for (const id of snapshot.sourceIds) target.add(id);
	return target;
}
