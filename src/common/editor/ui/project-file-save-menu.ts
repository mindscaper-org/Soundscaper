/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveProjectExtensionCopy } from './project-extension-copy.ts';
import { createCrossProductHandoffMenuItems } from './cross-product-handoff-menu.ts';
import { createSessionSnapshotMenuItems } from './session-snapshot-menu.ts';
import { createSubprojectMenuItems } from './subproject-menu.ts';

interface Input {
	readonly productId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
	readonly editBlocked: boolean;
	readonly handoffBlocked: boolean;
	readonly readOnly: boolean;
	readonly crossProductHandoffAvailable: boolean;
	readonly actions: Readonly<Record<string, unknown>> & {
		readonly saveProject: () => unknown;
		readonly saveScape: () => unknown;
		readonly openSessionSnapshots: () => unknown;
		readonly openSubprojects: () => unknown;
	};
}

/** Keep save, named alternatives and editable copies together in the existing File menu. */
export function createProjectFileSaveMenuItems(input: Input) {
	const { productId, copy, blocked, editBlocked, handoffBlocked, actions } = input;
	const projectFileCopy = resolveProjectExtensionCopy(copy, productId);
	return [
		{ id: 'save-project', label: copy.saveProject, shortcut: 'Ctrl+S', disabled: editBlocked, onClick: actions.saveProject },
		...createSessionSnapshotMenuItems(productId, copy, editBlocked, actions.openSessionSnapshots),
		...createSubprojectMenuItems(productId, copy, editBlocked, actions.openSubprojects),
		{ id: 'file-save-as', label: projectFileCopy.saveScape, preserveLabel: true,
			resolve: () => ({ disabled: blocked && !input.readOnly }), onClick: actions.saveScape },
		...createCrossProductHandoffMenuItems({ productId, copy: { ...copy, ...projectFileCopy }, handoffBlocked,
			available: input.crossProductHandoffAvailable, actions }),
	];
}
