/* SPDX-License-Identifier: AGPL-3.0-only */

type CacheOperation<Value> = () => PromiseLike<Value> | Value;

/** A waveform cache miss must never change the availability of its original PCM. */
export async function loadOptionalWaveformPeaks<Value>(read: CacheOperation<Value>): Promise<Value | null> {
	try { return await read(); }
	catch { return null; }
}

/** Keep newly computed peaks usable even if their optional durable cache is full. */
export async function saveOptionalWaveformPeaks(write: CacheOperation<unknown>): Promise<void> {
	try { await write(); }
	catch { /* Original PCM and the in-memory peaks remain authoritative. */ }
}
