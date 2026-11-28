/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import { TRACK_COPY_BY_LOCALE } from '../../common/i18n/track-copy.js';
import { isTracktionAutomationParameter, TRACKTION_AUTOMATION_PAGE_SIZE, TRACKTION_AUTOMATION_RANGES, type TracktionAutomationEdit,
	type TracktionAutomationPage, type TracktionAutomationParameter } from '../tracktion-automation-contract.ts';
import { TracktionEditForm } from './TracktionEditForm.tsx';

const copy = TRACK_COPY_BY_LOCALE.en;

interface AutomationDialogProps {
	readonly parameter: TracktionAutomationParameter;
	readonly page: TracktionAutomationPage;
	readonly offset: number;
	readonly selectedPointIndex: number | null;
	readonly busy: boolean;
	readonly onPage: (parameter: TracktionAutomationParameter, offset: number) => void;
	readonly onEdit: (edit: TracktionAutomationEdit) => void;
}

export function TracktionAutomationDialog({ track, onDismiss, failure, ...editor }: AutomationDialogProps & {
	readonly track: string;
	readonly failure: string;
	readonly onDismiss: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => { dialog.current?.showModal(); }, []);
	return <dialog ref={dialog} aria-label={copy.tracktionAutomation} onCancel={(event) => {
		event.preventDefault();
		if (!editor.busy) onDismiss();
	}}>
		<h2>{copy.tracktionAutomation}</h2>
		<fieldset disabled={editor.busy}>
			<legend>{track}</legend>
			<p><label>{copy.tracktionAutomationParameter} <select value={editor.parameter} onChange={(event) => {
				const parameter = event.currentTarget.value;
				if (isTracktionAutomationParameter(parameter)) editor.onPage(parameter, 0);
			}}>
				<option value="gainDb">{copy.gain} (dB)</option>
				<option value="pan">{copy.pan}</option>
			</select></label></p>
			<AutomationPointEditor key={`${editor.page.revision}:${editor.parameter}:${editor.offset}`} {...editor} />
		</fieldset>
		{failure && <p role="alert">{failure}</p>}
		<button type="button" disabled={editor.busy} onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.close}</button>
	</dialog>;
}

function AutomationPointEditor({ parameter, page, offset, selectedPointIndex, onPage, onEdit }: AutomationDialogProps) {
	const [selection, setSelection] = useState(() => {
		const selected = selectedPointIndex === null ? -1 : selectedPointIndex - offset;
		return page.points[selected] ? String(selected) : 'new';
	});
	const point = page.points[Number(selection)];
	const index = point ? offset + Number(selection) : null;
	const [min, max] = TRACKTION_AUTOMATION_RANGES[parameter];
	const { nextOffset } = page;

	function apply(fields: FormData): void {
		onEdit({ kind: 'setAutomationPoint', parameter, index, frame: Number(fields.get('frame')),
			value: Number(fields.get('value')), curve: Number(fields.get('curve')) });
	}

	return <>
		<p><label>{copy.tracktionAutomationPoint} <select value={selection} onChange={(event) => setSelection(event.currentTarget.value)}>
			<option value="new">{copy.tracktionNewAutomationPoint}</option>
			{page.points.map((entry, index) => <option key={index} value={index}>{entry.frame} · {entry.value.toFixed(3)}</option>)}
		</select></label></p>
		{(offset > 0 || nextOffset !== null) && <p>
			<button type="button" disabled={offset === 0} onClick={() => onPage(parameter, Math.max(0, offset - TRACKTION_AUTOMATION_PAGE_SIZE))}>{copy.tracktionPreviousAutomationPage}</button>{' '}
			<button type="button" disabled={nextOffset === null} onClick={() => { if (nextOffset !== null) onPage(parameter, nextOffset); }}>{copy.tracktionNextAutomationPage}</button>
		</p>}
		<TracktionEditForm key={selection} onApply={apply}>
			<p><label>{copy.tracktionAutomationFrame} <input name="frame" type="number" min="0" step="1" required defaultValue={point?.frame ?? 0} /></label></p>
			<p><label>{copy.tracktionAutomationValue} <input name="value" type="number" min={min} max={max} step="any" required defaultValue={point?.value ?? 0} /></label></p>
			<p><label>{copy.tracktionAutomationCurve} <input name="curve" type="number" min="-1" max="1" step="any" required defaultValue={point?.curve ?? 0} /></label></p>
			<button type="submit">{index === null ? copy.tracktionAddAutomationPoint : copy.tracktionUpdateAutomationPoint}</button>{' '}
			{index !== null && <button type="button" onClick={() => onEdit({ kind: 'removeAutomationPoint', parameter, index })}>{copy.tracktionRemoveAutomationPoint}</button>}{' '}
			{page.points.length > 0 && <button type="button" onClick={() => onEdit({ kind: 'clearAutomation', parameter })}>{copy.tracktionClearAutomation}</button>}
		</TracktionEditForm>
	</>;
}
