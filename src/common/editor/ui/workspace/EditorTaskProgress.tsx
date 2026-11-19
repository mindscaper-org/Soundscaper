/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import EditorToast from '../EditorToast.tsx';
import {
	selectFallbackTaskProgress,
	selectTaskProgressPresentation,
	type TaskProgressBusySnapshot,
	type TaskProgressViewModel,
} from '../task-progress-ui-model.ts';
import EditorTaskProgressBar from './EditorTaskProgressBar.tsx';

interface TelemetryController {
	readonly subscribeTelemetry: (listener: () => void) => () => void;
	readonly getTelemetrySnapshot: () => Readonly<{ taskProgress?: TaskProgressViewModel | null }>;
	readonly actions?: Readonly<{ project?: Readonly<{ cancelTask?: () => unknown }> }>;
}

/** Task lifetime owns the surface; toolbar visibility and toast preferences do not. */
export default function EditorTaskProgress({ controller, snapshot, statusMessage, cancelLabel, overlayTarget }: Readonly<{
	controller: TelemetryController;
	snapshot: TaskProgressBusySnapshot;
	statusMessage: string;
	cancelLabel: string;
	overlayTarget?: Element | null;
}>) {
	const telemetryProgress = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: Readonly<{ taskProgress?: TaskProgressViewModel | null }>) => telemetry.taskProgress ?? null,
	);
	const active = telemetryProgress || selectFallbackTaskProgress(snapshot, statusMessage);
	if (!active) return null;
	const progress = active.label ? active : { ...active, label: statusMessage };
	const cancelTask = controller.actions?.project?.cancelTask;
	const bar = <EditorTaskProgressBar progress={progress} cancelLabel={cancelLabel}
		onCancel={cancelTask ? () => { cancelTask(); } : undefined} />;
	if (selectTaskProgressPresentation(snapshot) === 'toast') {
		return <EditorToast key={progress.id} id={`task-progress-${progress.id}`} title={progress.label}
			persistent progressContent={bar} />;
	}
	const dialog = <AudioEditorDialogShell title={progress.label} width={440} initialFocus="dialog"
		closeOnOutside={false} dataAttributes={{ 'data-task-progress-dialog': true }}>
		{bar}
	</AudioEditorDialogShell>;
	return overlayTarget ? createPortal(dialog, overlayTarget) : dialog;
}
