/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TaskProgressViewModel } from '../task-progress-ui-model.ts';

export default function EditorTaskProgressBar({
	progress,
	onCancel,
	cancelLabel,
}: Readonly<{
	progress: TaskProgressViewModel;
	onCancel?: () => void;
	cancelLabel: string;
}>) {
	const determinate = progress.value != null;
	const percentage = determinate
		? Math.round(Math.max(0, Math.min(1, Number(progress.value) || 0)) * 100)
		: null;
	const label = progress.label;

	return (
		<div
			className="kw-audio-editor__task-progress"
			data-editor-task-progress={progress.kind}
			data-indeterminate={determinate ? undefined : ''}
		>
			<div
				className="kw-audio-editor__task-progress-track"
				role="progressbar"
				aria-label={label}
				aria-valuemin={determinate ? 0 : undefined}
				aria-valuemax={determinate ? 100 : undefined}
				aria-valuenow={percentage ?? undefined}
			>
				<span
					className="kw-audio-editor__task-progress-fill"
					style={determinate ? { width: `${percentage}%` } : undefined}
				/>
			</div>
			{percentage != null && <output aria-label={`${label}: ${percentage}%`}>{percentage}%</output>}
			{progress.cancellable && onCancel && (
				<button type="button" className="kw-audio-editor__task-progress-cancel" onClick={onCancel}>{cancelLabel}</button>
			)}
		</div>
	);
}
