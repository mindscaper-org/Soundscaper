/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectedTrackRemovalAvailable } from '../selected-track-removal.ts';
import { resolveTrackPlaylistCopy } from '../../i18n/editor-track-playlist-copy.ts';
import { createMidiTrackMenuItems } from './midi-application-menu.ts';

interface Context {
	readonly productId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly project: Parameters<typeof selectedTrackRemovalAvailable>[0];
	readonly trackId: string | null | undefined;
	readonly selectedAudioTrack: { readonly locked?: unknown; readonly audioFreeze?: unknown } | null | undefined;
	readonly blocked: boolean;
	readonly actions: { readonly openTrackPlaylists: () => unknown; readonly duplicateTrack: () => unknown; readonly removeTrack: () => unknown };
}

/** Keep track arrangement commands together in the existing Tracks menu. */
export function createTrackArrangementMenuItems({ productId, copy, project, trackId, selectedAudioTrack, blocked, actions }: Context) {
	return [
		...(productId === 'soundscaper' ? [{ id: 'track-playlists', label: resolveTrackPlaylistCopy(copy).title,
			preserveLabel: true, tooltipKey: 'track-playlists',
			disabled: blocked || !selectedAudioTrack || Boolean(selectedAudioTrack.locked || selectedAudioTrack.audioFreeze),
			onClick: actions.openTrackPlaylists }] : []),
		{ id: 'duplicate-track', label: copy.duplicateTrack, disabled: blocked || !selectedAudioTrack, onClick: actions.duplicateTrack },
		{ id: 'remove-track', label: copy.removeTracks, disabled: blocked || !selectedTrackRemovalAvailable(project, trackId), onClick: actions.removeTrack },
	];
}

export function createTrackCreationMenu(context: Pick<Context, 'productId' | 'copy' | 'blocked'>,
	actions: { readonly addAudioTrack: () => unknown; readonly addMidiTrack: () => unknown; readonly addLabelTrack: () => unknown }) {
	return { id: 'add-new-track', label: context.copy.addNewTrack, items: [
		{ id: 'new-audio-track', label: context.copy.audioTrack, disabled: context.blocked, onClick: actions.addAudioTrack },
		...createMidiTrackMenuItems(context, actions.addMidiTrack),
		{ id: 'new-label-track', label: context.copy.labelTrack, disabled: context.blocked, onClick: actions.addLabelTrack },
	] };
}
