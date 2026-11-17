/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSessionSnapshotCopy } from '../../i18n/editor-session-snapshot-copy.ts';

export function createSessionSnapshotMenuItems(productId: string, copy: Readonly<Record<string, string>>,
	blocked: boolean, open: () => unknown) {
	if (productId !== 'soundscaper') return [];
	return [{ id: 'session-snapshots', label: resolveSessionSnapshotCopy(copy).title, preserveLabel: true,
		tooltipKey: 'session-snapshots', disabled: blocked, onClick: open }];
}
