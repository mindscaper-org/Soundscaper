/* SPDX-License-Identifier: AGPL-3.0-only */
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../../../i18n/workspace-layout-copy.js';
import { formatLocalizedTemplate } from '../localization-template.ts';

const ENGLISH = WORKSPACE_LAYOUT_COPY_BY_LOCALE.en;
const OPERATIONS: Readonly<Record<string, keyof typeof ENGLISH | 'addTrack'>> = Object.freeze({
	'source/add': 'historyAddMedia', 'source/remove': 'historyRemoveMedia',
	'clip/add': 'historyAddClip', 'clip/remove': 'historyRemoveClip', 'clip/move': 'historyMoveClip',
	'clip/update': 'historyEditClip', 'clip/split': 'historySplitClip',
	'track/add': 'addTrack', 'track/remove': 'historyRemoveTrack', 'track/update': 'historyEditTrack',
	'mixer/update': 'historyEditMixer', 'project/update': 'historyEditProject',
});
export function historyOperationLabel(entry: Readonly<{ commandCount?: number; commands?: readonly string[]; type?: string }>, copy: Readonly<Record<string, string | undefined>>): string {
	const count = entry.commandCount || entry.commands?.length || 1;
	if (count > 1) return formatLocalizedTemplate(copy.historyBatch ?? ENGLISH.historyBatch, { count });
	const key = OPERATIONS[entry.commands?.[0] || entry.type || ''] ?? 'historyEditProject';
	const label = key === 'addTrack' ? copy.addTrack ?? 'Add track' : copy[key] ?? ENGLISH[key];
	return formatLocalizedTemplate(copy.historyCommand ?? ENGLISH.historyCommand, { command: label, count });
}
