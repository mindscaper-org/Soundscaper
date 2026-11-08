/* SPDX-License-Identifier: AGPL-3.0-only */

/** Finish on window exit and allow unmount to retire a pending gesture silently. */
export function retainPianoRollMouseGesture(owner: Document, move: (event: MouseEvent) => void, onFinish: () => void): () => void {
	let active = true;
	const release = () => {
		if (!active) return;
		active = false;
		owner.removeEventListener('mousemove', move);
		owner.removeEventListener('mouseup', finish);
		owner.defaultView?.removeEventListener('blur', finish);
	};
	const finish = (event: Event) => {
		if ('button' in event && event.button !== 0) return;
		if (active) { release(); onFinish(); }
	};
	owner.addEventListener('mousemove', move);
	owner.addEventListener('mouseup', finish);
	owner.defaultView?.addEventListener('blur', finish);
	return release;
}
