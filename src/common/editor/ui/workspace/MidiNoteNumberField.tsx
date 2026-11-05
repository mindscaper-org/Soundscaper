/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

interface MidiNoteNumberFieldProps {
	readonly value: number | '';
	readonly min: number;
	readonly max?: number;
	readonly step: number;
	readonly disabled: boolean;
	readonly title?: string;
	readonly onCommit: (value: number) => void;
}

/** Keep an authored number intact while the asynchronous note edit is pending. */
export function MidiNoteNumberField({ value, min, max, step, disabled, title, onCommit }: MidiNoteNumberFieldProps) {
	const [draft, setDraft] = useState(String(value));
	const focused = useRef(false);
	const cancelled = useRef(false);
	useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
	return <input type="number" min={min} max={max} step={step} disabled={disabled} title={title} value={draft}
		onFocus={() => { focused.current = true; cancelled.current = false; }}
		onChange={event => setDraft(event.currentTarget.value)}
		onBlur={() => {
			focused.current = false;
			const parsed = Number(draft);
			if (cancelled.current || !draft.trim() || !Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)
				|| (step === 1 && !Number.isInteger(parsed))) { setDraft(String(value)); return; }
			if (parsed !== value) onCommit(parsed);
		}}
		onKeyDown={event => {
			if (event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) return;
			if (event.key !== 'Enter' && event.key !== 'Escape') return;
			event.preventDefault(); event.stopPropagation();
			cancelled.current = event.key === 'Escape';
			if (cancelled.current) setDraft(String(value));
			event.currentTarget.blur();
		}} />;
}
