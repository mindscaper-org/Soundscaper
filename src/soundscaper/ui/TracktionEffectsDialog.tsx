/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';

import { TRACK_COPY_BY_LOCALE } from '../../common/i18n/track-copy.js';
import type { TracktionEffectInstallation, TracktionEffectSlot } from '../tracktion-effect-contract.ts';
import { useTracktionModalDialog } from './useTracktionModalDialog.ts';

const copy = TRACK_COPY_BY_LOCALE.en;
export const tracktionEffectsTitle = copy.tracktionOfflineEffects;

export function TracktionEffectsDialog({ track, slots, catalog, onAdd, onRemove, onScan, onDismiss }: {
	readonly track: string;
	readonly slots: readonly TracktionEffectSlot[];
	readonly catalog: readonly TracktionEffectInstallation[] | null;
	readonly onAdd: (installationId: string) => void;
	readonly onRemove: (slotId: string) => void;
	readonly onScan?: () => void;
	readonly onDismiss: () => void;
}) {
	const dialog = useTracktionModalDialog();
	const [installation, setInstallation] = useState(catalog?.[0]?.id ?? '');
	const [slot, setSlot] = useState(slots[0]?.id ?? '');
	return <dialog ref={dialog} aria-label={tracktionEffectsTitle} onCancel={onDismiss}>
		<h2>{tracktionEffectsTitle}</h2>
		<p>{track}</p>
		<p>{copy.tracktionOfflinePlayback}</p>
		{slots.length > 0 && <p>
			<label>{copy.tracktionEffectSlots} <select value={slot} onChange={(event) => setSlot(event.currentTarget.value)}>
				{slots.map(({ id, name, format }) => <option key={id} value={id}>{name} ({format.toUpperCase()})</option>)}
			</select></label>{' '}
			<button type="button" disabled={!slot} onClick={() => onRemove(slot)}>{copy.tracktionRemoveEffect}</button>
		</p>}
		{catalog && (catalog.length > 0 ? <p>
			<label>{copy.tracktionInstalledEffects} <select value={installation} onChange={(event) => setInstallation(event.currentTarget.value)}>
				{catalog.map(({ id, name, vendor, format }) => <option key={id} value={id}>{name} ({[vendor, format.toUpperCase()].filter(Boolean).join(' · ')})</option>)}
			</select></label>{' '}
			<button type="button" disabled={!installation} onClick={() => onAdd(installation)}>
				{catalog.find(({ id }) => id === installation)?.allowed ? copy.tracktionAddEffect : copy.tracktionReviewEffect}
			</button>
		</p> : <p>{copy.tracktionNoInstalledEffects}</p>)}
		{!catalog && slots.length === 0 && <p>{copy.tracktionNoEffectSlots}</p>}
		{onScan && <button type="button" onClick={onScan}>{copy.tracktionScanEffects}</button>}{' '}
		<button type="button" onClick={onDismiss}>Close</button>
	</dialog>;
}
