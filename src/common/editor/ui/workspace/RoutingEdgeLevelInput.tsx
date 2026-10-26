/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';

interface RoutingEdgeLevelInputProps {
	readonly label: string;
	readonly savedLevel: number;
	readonly disabled: boolean;
	readonly onBegin: (value: number) => void;
	readonly onPreview: (value: number) => void;
	readonly onRelease: (value: number) => void;
	readonly onCancel: () => void;
	readonly hasActiveGesture: () => boolean;
}

export function routingLevelDisplayDb(value: number): number {
	return value > 0 ? Math.max(-60, Math.min(12.04, Number((20 * Math.log10(value)).toFixed(2)))) : -60;
}

export function routingLevelDraftValue(draft: string, unchangedLevel?: number): number | null {
	if (draft.trim() === '') return null;
	const value = Number(draft);
	if (unchangedLevel !== undefined && value === routingLevelDisplayDb(unchangedLevel)) return unchangedLevel;
	return Number.isFinite(value) && value >= -60 && value <= 12.04
		? value === -60 ? 0 : 10 ** (value / 20) : null;
}

export default function RoutingEdgeLevelInput(props: RoutingEdgeLevelInputProps) {
	const { savedLevel, onBegin, onPreview, onRelease, onCancel } = props;
	const savedDb = routingLevelDisplayDb(savedLevel);
	const edited = useRef(false);
	const readValue = (draft: string) => routingLevelDraftValue(draft, edited.current ? undefined : savedLevel);
	return <label>{props.label} <input
		name="levelDb" type="number" min={-60} max={12.04} step="0.01" required
		defaultValue={savedDb} disabled={props.disabled}
		onFocus={(event) => {
			edited.current = false;
			const value = readValue(event.currentTarget.value);
			if (value !== null) onBegin(value);
		}}
		onChange={(event) => {
			edited.current = true;
			const value = readValue(event.currentTarget.value);
			if (value !== null) onPreview(value);
		}}
		onBlur={(event) => {
			const value = readValue(event.currentTarget.value);
			if (value !== null) onRelease(value);
			else {
				event.currentTarget.value = String(savedDb);
				edited.current = false;
				onCancel();
			}
		}}
		onKeyDown={(event) => {
			if (event.key !== 'Escape' || !props.hasActiveGesture()) return;
			event.preventDefault();
			event.currentTarget.value = String(savedDb);
			edited.current = false;
			onCancel();
			event.currentTarget.blur();
		}}
	/></label>;
}
