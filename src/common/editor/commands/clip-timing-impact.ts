/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './protocol.ts';

/** These closed handlers mutate document/strip/label state without writing clip timing. */
const TIMING_NEUTRAL = new Set<AudioEditorCommand['type']>([
	'project/rename', 'selection/set', 'track/update', 'master/update',
	'track-folder/update', 'label/add', 'label/update', 'label/remove',
]);

/** New or mixed timing-changing command families keep the exact before/after comparison. */
export function commandCanChangeClipTiming(command: AudioEditorCommand): boolean {
	return !TIMING_NEUTRAL.has(command.type);
}
