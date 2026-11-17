/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, BatchAudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { applyTrackPlaylistCommand } from '../common/editor/commands/track-playlist-runtime.ts';
import { TRACK_PLAYLIST_COMMAND_TYPES, type TrackPlaylistCommand } from '../common/editor/commands/track-playlist.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';

/** Capture persisted timing, before the inherited command adapter resolves sample coordinates. */
export function hasTrackPlaylistCommand(command: Readonly<{ type: string }>): command is TrackPlaylistCommand | BatchAudioEditorCommand {
	return command.type === 'batch' ? (command as BatchAudioEditorCommand).commands.some(hasTrackPlaylistCommand)
		: TRACK_PLAYLIST_COMMAND_TYPES.some(type => type === command.type);
}

export function applyTrackPlaylistCommandTree(project: SoundscaperProject, command: AudioEditorCommand,
	applyChild: (project: SoundscaperProject, command: AudioEditorCommand) => SoundscaperProject): Record<string, unknown> {
	if (command.type === 'batch') {
		let current = project;
		for (const child of command.commands) current = applyChild(current, child);
		return structuredClone(current) as Record<string, unknown>;
	}
	const draft = structuredClone(project) as Record<string, unknown>;
	applyTrackPlaylistCommand(draft, command as TrackPlaylistCommand);
	return draft;
}
