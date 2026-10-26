/* SPDX-License-Identifier: AGPL-3.0-only */

interface ListeningMedia {
	volume: number;
	addEventListener(type: 'loadedmetadata', listener: () => void): void;
	removeEventListener(type: 'loadedmetadata', listener: () => void): void;
}

/** Native media loading can replace the gain assigned before its player exists. */
export function restoreMediaListeningGainOnMetadata(
	media: ListeningMedia,
	currentGain: () => number,
): () => void {
	let pending = true;
	const retire = (): void => {
		pending = false;
		media.removeEventListener('loadedmetadata', ready);
	};
	const ready = (): void => {
		if (!pending) return;
		retire();
		media.volume = currentGain();
	};
	media.addEventListener('loadedmetadata', ready);
	return retire;
}
