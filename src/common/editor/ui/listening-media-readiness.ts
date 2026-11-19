/* SPDX-License-Identifier: AGPL-3.0-only */

/** Restore native load resets once per readiness phase, retaining later volume edits. */
export function bindListeningMediaReadiness(
	player: Pick<HTMLMediaElement, 'volume' | 'addEventListener'>,
	readCurrentGain: () => number,
	isCurrentPlayer: () => boolean,
): () => void {
	const listeners = new AbortController();
	let active = true;
	const ready = new Set<string>();
	const beginLoad = (): void => { if (active && isCurrentPlayer()) ready.clear(); };
	const restoreGain = (event: Event): void => {
		if (!active || !isCurrentPlayer() || ready.has(event.type)) return;
		ready.add(event.type);
		player.volume = readCurrentGain();
	};
	player.addEventListener('loadstart', beginLoad, { signal: listeners.signal });
	player.addEventListener('loadedmetadata', restoreGain, { signal: listeners.signal });
	player.addEventListener('loadeddata', restoreGain, { signal: listeners.signal });
	return () => {
		active = false;
		listeners.abort();
	};
}
