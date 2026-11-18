/* SPDX-License-Identifier: AGPL-3.0-only */

const workerInputs = new WeakSet<readonly Float32Array[]>();

/** A structured-cloned worker input can be reread while its progress is posted. */
export function registerSelectionWorkerPcm(channels: readonly Float32Array[]): void {
	if (channels.every(channel => channel.buffer instanceof ArrayBuffer)) workerInputs.add(channels);
}

export function ownsSelectionWorkerPcm(channels: readonly Float32Array[]): boolean {
	return workerInputs.has(channels);
}
