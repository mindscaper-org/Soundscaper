/* SPDX-License-Identifier: AGPL-3.0-only */

import { isMidiTrack } from '../../midi-model.ts';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { LabeledDropdown } from './inspector-controls.jsx';

interface Props {
	readonly tracks?: readonly Readonly<{ id: string; name: string }>[];
	readonly value: string;
	readonly copy: Record<string, string>;
	readonly disabled?: boolean;
	readonly onChange: (value: string) => unknown;
}

export default function AutoTuneControlTrack({ tracks = [], value, copy, disabled, onChange }: Props) {
	const options = [{ value: '', label: canonicalCopyValue('effectAutoTuneNoControl', copy) },
		...tracks.filter(isMidiTrack).map(track => ({ value: track.id, label: track.name }))];
	if (value && !options.some(option => option.value === value)) options.push({ value, label: canonicalCopyValue('effectAutoTuneMissingControl', copy) });
	return <LabeledDropdown label={copy.controlTrack} value={value} options={options}
		disabled={disabled} onChange={onChange} hook="effect-param-controlTrackId" />;
}
