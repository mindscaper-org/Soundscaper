/* SPDX-License-Identifier: AGPL-3.0-only */
import { trackHeightCopy } from '../../../i18n/editor-track-height-copy.ts';

export function createTrackHeightMenu(input: Readonly<{
	copy: Readonly<Record<string, string>>; disabled: boolean;
	onDecrease: () => unknown; onIncrease: () => unknown; onFit: () => unknown;
}>) {
	const copy = trackHeightCopy(input.copy);
	return {
		id: 'local://track-height', label: copy.trackHeight,
		items: [
			{ id: 'local://decrease-track-height', label: input.copy.decreaseTrackHeight ?? 'Decrease track height', onClick: input.onDecrease },
			{ id: 'local://increase-track-height', label: input.copy.increaseTrackHeight ?? 'Increase track height', onClick: input.onIncrease },
			{ id: 'local://fit-track-height', label: copy.fitToHeight, onClick: input.onFit },
		].map(item => ({ ...item, disabled: input.disabled })),
	};
}

/** Read the owning editor's measured lane space; detached controls have no viewport yet. */
export function trackHeightViewportSpace(anchor: Element | null): number | undefined {
	const timeline = anchor?.closest('[data-audio-editor]')?.querySelector<HTMLElement>('[data-track-height-available]');
	const height = Number(timeline?.dataset.trackHeightAvailable);
	return Number.isFinite(height) && height > 0 ? height : undefined;
}
