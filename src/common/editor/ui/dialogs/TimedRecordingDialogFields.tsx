/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useState, type ComponentProps } from 'react';
import AudioEditorTimeCodeInput, { audioEditorProjectFrameRate, audioEditorProjectSampleRate } from '../AudioEditorTimeCodeInput.tsx';
import EditorMusicalTimeCodeProvider from '../EditorMusicalTimeCodeProvider.tsx';
import {
	normalizeTimedRecordingDialogValue,
	timedRecordingLocalDateTimeValid,
	type TimedRecordingDialogValue,
	updateTimedRecordingDialogDuration,
	updateTimedRecordingDialogEnd,
	updateTimedRecordingDialogEndMode,
	updateTimedRecordingDialogStart,
} from './timed-recording-dialog-model.ts';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface TimedRecordingDialogCopy extends Readonly<Record<string, string>> {
	readonly timedRecordingStartTime: string;
	readonly timedRecordingEnd: string;
	readonly timedRecordingDuration: string;
	readonly timedRecordingEndDateTime: string;
	readonly timedRecordingCurrent: string;
	readonly timedRecordingCurrentRange: string;
}

interface ScheduledRecording {
	readonly startTimeMs: number;
	readonly endTimeMs?: number;
}

interface TimedRecordingDialogFieldsProps {
	readonly project?: unknown;
	readonly controller?: ComponentProps<typeof EditorMusicalTimeCodeProvider>['controller'];
	readonly originFrame?: number;
	readonly value: unknown;
	readonly onValueChange: (value: TimedRecordingDialogValue) => void;
	readonly onSubmit: () => void;
	readonly startExpired?: boolean;
	readonly scheduledRecording?: ScheduledRecording | null;
	readonly copy: TimedRecordingDialogCopy;
	readonly locale: string;
}

/** Refresh the form and footer together when the selected wall-clock start passes. */
export function useTimedRecordingStartExpired(startTimeMs: number | undefined): boolean {
	const [, setExpiredAt] = useState(0);
	useEffect(() => {
		if (startTimeMs === undefined || !Number.isFinite(startTimeMs) || startTimeMs <= Date.now()) return;
		let timer: ReturnType<typeof setTimeout>;
		const refreshAtDeadline = (): void => {
			const now = Date.now();
			const remaining = startTimeMs - now;
			if (remaining <= 0) setExpiredAt(now);
			else timer = setTimeout(refreshAtDeadline, Math.min(remaining, 2_147_000_000));
		};
		refreshAtDeadline();
		return () => clearTimeout(timer);
	}, [startTimeMs]);
	return startTimeMs !== undefined && Number.isFinite(startTimeMs) && startTimeMs <= Date.now();
}

export default function TimedRecordingDialogFields({
	project,
	controller,
	originFrame = 0,
	value,
	onValueChange,
	onSubmit,
	startExpired = false,
	scheduledRecording,
	copy,
	locale,
}: TimedRecordingDialogFieldsProps) {
	const model = normalizeTimedRecordingDialogValue(value);
	const invalidDateId = useId();
	const expiredStartId = useId();
	const startInvalid = model.startTime !== '' && !timedRecordingLocalDateTimeValid(model.startTime);
	const endInvalid = model.endMode === 'end' && model.endTime !== ''
		&& !timedRecordingLocalDateTimeValid(model.endTime);
	return <form data-timed-recording-dialog onSubmit={(event) => {
		event.preventDefault();
		onSubmit();
	}}>
		<label className="kw-audio-editor-dialog__field kw-audio-editor-timed-recording__start">
			<EditorControlLabel>{copy.timedRecordingStartTime}</EditorControlLabel>
			<input
				className="kw-audio-editor-timed-recording__control"
				type="datetime-local"
				step="0.001"
				value={model.startTime}
				aria-invalid={startInvalid || startExpired || undefined}
				aria-describedby={startInvalid ? invalidDateId : startExpired ? expiredStartId : undefined}
				onChange={(event) => onValueChange(updateTimedRecordingDialogStart(
					model,
					event.currentTarget.value,
				))}
			/>
		</label>
		<fieldset className="kw-audio-editor-timed-recording__end">
			<legend>{copy.timedRecordingEnd}</legend>
			<div className="kw-audio-editor-timed-recording__end-option">
				<label>
					<input type="radio" name="timed-recording-end-mode" value="duration"
						checked={model.endMode === 'duration'} onChange={() => onValueChange(
							updateTimedRecordingDialogEndMode(model, 'duration'),
						)} />
					<EditorControlLabel>{copy.timedRecordingDuration}</EditorControlLabel>
				</label>
				<EditorMusicalTimeCodeProvider controller={controller} originFrame={originFrame}>
					<AudioEditorTimeCodeInput label={copy.timedRecordingDuration}
					className="kw-audio-editor-timed-recording__control" variant="light"
					value={model.durationSeconds} unit="seconds" minimum={0.001}
					sampleRate={audioEditorProjectSampleRate(project)} frameRate={audioEditorProjectFrameRate(project)}
					disabled={model.endMode !== 'duration'} onChange={(duration) => onValueChange(
						updateTimedRecordingDialogDuration(model, duration),
					)} />
				</EditorMusicalTimeCodeProvider>
			</div>
			<div className="kw-audio-editor-timed-recording__end-option">
				<label>
					<input type="radio" name="timed-recording-end-mode" value="end"
						checked={model.endMode === 'end'} onChange={() => onValueChange(
							updateTimedRecordingDialogEndMode(model, 'end'),
						)} />
					<EditorControlLabel>{copy.timedRecordingEndDateTime}</EditorControlLabel>
				</label>
				<input className="kw-audio-editor-timed-recording__control"
					type="datetime-local" step="0.001" aria-label={copy.timedRecordingEndDateTime}
					value={model.endTime} disabled={model.endMode !== 'end'}
					aria-invalid={endInvalid || undefined} aria-describedby={endInvalid ? invalidDateId : undefined}
					onChange={(event) => onValueChange(updateTimedRecordingDialogEnd(
						model,
						event.currentTarget.value,
					))} />
			</div>
		</fieldset>
		{(startInvalid || endInvalid) && <p id={invalidDateId} role="alert">
			{copy.timedRecordingInvalidLocalDateTime}
		</p>}
		{startExpired && <p id={expiredStartId} role="alert">{copy.timedRecordingPast}</p>}
		{scheduledRecording && <p>{scheduledRecordingText(scheduledRecording, copy, locale)}</p>}
	</form>;
}

function scheduledRecordingText(
	scheduled: ScheduledRecording,
	copy: TimedRecordingDialogCopy,
	locale: string,
): string {
	const start = new Date(scheduled.startTimeMs).toLocaleString(locale);
	if (scheduled.endTimeMs === undefined) return copy.timedRecordingCurrent.replace('{time}', start);
	return copy.timedRecordingCurrentRange
		.replace('{start}', start)
		.replace('{end}', new Date(scheduled.endTimeMs).toLocaleString(locale));
}
