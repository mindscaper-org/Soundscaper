/* SPDX-License-Identifier: AGPL-3.0-only */

interface NativeDownloadCurrentV1 { once(event: 'done', listener: () => void): unknown }

/** Native save dialogs and writes outlive the renderer's download-started
 * acknowledgment. Consult renderer close safety only after native completion. */
export function createLightscaperDownloadLifetimeCurrentV1() {
	const active = new Set<NativeDownloadCurrentV1>();
	let deferred: (() => void) | undefined;
	return Object.freeze({
		track(item: NativeDownloadCurrentV1): void {
			if (active.has(item)) return;
			active.add(item);
			const release = () => {
				if (!active.delete(item) || active.size) return;
				const close = deferred; deferred = undefined; close?.();
			};
			try { item.once('done', release); } catch (error) { release(); throw error; }
		},
		deferClose(close: () => void): boolean {
			if (!active.size) return false;
			deferred = close; return true;
		},
	});
}
