/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveSubprojectCopy } from '../../i18n/editor-subproject-copy.ts';

export function createSubprojectMenuItems(productId: string, copy: Readonly<Record<string, string>>,
	blocked: boolean, open: () => unknown) {
	if (productId !== 'soundscaper') return [];
	return [{ id: 'subprojects', label: resolveSubprojectCopy(copy).title, preserveLabel: true,
		tooltipKey: 'subprojects', disabled: blocked, onClick: open }];
}
