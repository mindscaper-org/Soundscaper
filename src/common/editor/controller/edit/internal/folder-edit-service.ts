/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertFolderContentEditable, FolderContentEditError, folderContentTarget } from '../../../folder-content-editing.ts';
import { prepareRangeDeleteCommand } from '../../../commands/range-runtime.js';
import type { AudioEditorClipboard, AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ClipboardEditProject, ClipboardEditService, ClipboardEditState } from './clipboard-edit-service.ts';
import type { EditorControllerLifetime } from '../../shared/lifecycle.ts';
import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import type { SelectedLabelState } from '../../../label-clipboard-selection.ts';

export const FOLDER_EDIT_ACTIONS = ['select', 'split', 'delete', 'ripple-cut', 'ripple-delete', 'ripple-insert'] as const;
export type FolderEditAction = typeof FOLDER_EDIT_ACTIONS[number];

interface FolderEditDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly state: ClipboardEditState & SelectedLabelState & { selectedAnnotationId?: string | null };
	readonly copy: Readonly<{ timeSelectionRequired: string }>;
	getProject(): ClipboardEditProject;
	editingBlocked(allowReadOnly?: boolean): boolean;
	getPositionFrames(): number;
	updateSelection(command: AudioEditorCommand): unknown;
	commit(command: AudioEditorCommand): unknown;
	createClipboard(options: Readonly<{ startFrame: number; endFrame: number; trackIds: readonly string[] }>): AudioEditorClipboard;
	readonly clipboard: Pick<ClipboardEditService, 'prepareSessionClipboard' | 'commitSplitAtFrames' | 'prepareControllerPaste'>;
	commitPaste(command: AudioEditorCommand): unknown;
	publish(): void;
}

/** Folder actions name a subtree explicitly; current clip focus and default delete/paste preferences cannot widen it. */
export function createFolderEditService(dependencies: FolderEditDependencies) {
	return (action: FolderEditAction, folderId: string): unknown => {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return;
		const project = dependencies.getProject();
		const target = folderContentTarget(project, folderId);
		if (!target.trackIds.length) return;
		if (action === 'select') {
			const range = target.range ?? { startFrame: 0, endFrame: 0 };
			dependencies.state.selectedClipId = null;
			dependencies.state.selectedTrackId = target.trackIds[0] ?? null;
			dependencies.state.selectedLabels = [];
			dependencies.state.selectedLabelsProjectId = project.id;
			dependencies.state.selectedAnnotationId = null;
			return dependencies.updateSelection({ type: 'selection/set', ...range, trackIds: target.trackIds, clipIds: [], annotationIds: [], frequencyRange: null });
		}
		try { assertFolderContentEditable(project, target.trackIds); }
		catch (error) {
			if (error instanceof FolderContentEditError) throw createLocalizedError(RangeError, dependencies.copy, error.copyKey, undefined, { fallback: error.message });
			throw error;
		}
		const range = project.selection && project.selection.endFrame > project.selection.startFrame ? project.selection : null;
		if (action === 'split') return dependencies.clipboard.commitSplitAtFrames(
			range ? [range.startFrame, range.endFrame] : [dependencies.getPositionFrames()], target.trackIds,
		);
		if (action === 'ripple-insert') {
			if (!dependencies.state.clipboard) return;
			if (dependencies.state.clipboard.schemaVersion === 7) throw createLocalizedError(RangeError, dependencies.copy, 'folderClipboardMediaRequired', undefined, { fallback: 'Copy media before inserting into a track folder.' });
			return dependencies.commitPaste(dependencies.clipboard.prepareControllerPaste(
				'insert-track', range?.startFrame ?? dependencies.getPositionFrames(), true, { trackIds: target.trackIds },
			));
		}
		if (!range) throw createLocalizedError(Error, dependencies.copy, 'timeSelectionRequired');
		const publishClipboard = action === 'ripple-cut'
			? dependencies.clipboard.prepareSessionClipboard(dependencies.createClipboard({ ...range, trackIds: target.trackIds })) : null;
		const command = prepareRangeDeleteCommand(project, { ...range, trackIds: target.trackIds,
			rippleMode: action === 'delete' ? 'none' : 'track' }) as AudioEditorCommand;
		const result = dependencies.commit(command);
		publishClipboard?.();
		if (publishClipboard) dependencies.publish();
		return result;
	};
}
