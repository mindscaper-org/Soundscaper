/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../foundation/abort-race.ts';

interface KeyframeIndex {
	neighbours(timestamp: number): Promise<readonly number[]>;
	dispose(): void;
}

/** Disposable filmstrips may use a nearby keyframe; playback and edit timing stay exact. */
export function createVideoThumbnailKeyframeSelector(file: Blob,
	options: Readonly<{ openIndex?: (file: Blob) => Promise<KeyframeIndex> }> = {},
) {
	let opening: Promise<KeyframeIndex> | null = null;
	let index: KeyframeIndex | null = null;
	let disposed = false, unavailable = false;
	const lifetime = new AbortController();
	return { nearest, dispose };

	async function nearest(timestamp: number, duration: number, signal?: AbortSignal): Promise<number> {
		signal?.throwIfAborted(); lifetime.signal.throwIfAborted();
		if (unavailable) return timestamp;
		const deadline = new AbortController();
		const timer = setTimeout(() => { deadline.abort(); }, 1_000);
		const scope = AbortSignal.any([lifetime.signal, deadline.signal, ...(signal ? [signal] : [])]);
		try {
			opening ??= open();
			const ready = await raceAbortableRead(() => opening!, scope);
			const candidates = await raceAbortableRead(() => ready.neighbours(timestamp), scope);
			const valid = candidates.filter(value => Number.isFinite(value) && value >= 0 && value < duration);
			return valid.sort((left, right) => Math.abs(left - timestamp) - Math.abs(right - timestamp) || left - right)[0] ?? timestamp;
		} catch {
			signal?.throwIfAborted(); lifetime.signal.throwIfAborted();
			unavailable = true;
			release();
			return timestamp;
		} finally { clearTimeout(timer); }
	}
	async function open(): Promise<KeyframeIndex> {
		index = await (options.openIndex ?? openKeyframeIndex)(file);
		if (disposed || unavailable) { release(); throw new DOMException('Thumbnail index retired.', 'AbortError'); }
		return index;
	}
	function release(): void { const previous = index; index = null; previous?.dispose(); }
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		lifetime.abort();
		release();
	}
}

async function openKeyframeIndex(file: Blob): Promise<KeyframeIndex> {
	const { BlobSource, EncodedPacketSink, Input, MP4, QTFF, MATROSKA, WEBM } = await import('mediabunny');
	const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, MATROSKA, WEBM] });
	try {
		const tracks = await input.getVideoTracks();
		if (tracks.length !== 1) throw new Error('A thumbnail keyframe index requires one unambiguous video track.');
		const packets = new EncodedPacketSink(tracks[0]!);
		return {
			async neighbours(timestamp) {
				const before = await packets.getKeyPacket(timestamp, { metadataOnly: true });
				if (before?.timestamp === timestamp) return [timestamp];
				const after = before ? await packets.getNextKeyPacket(before, { metadataOnly: true })
					: await packets.getFirstKeyPacket({ metadataOnly: true });
				return [...(before ? [before.timestamp] : []), ...(after ? [after.timestamp] : [])];
			},
			dispose: () => input.dispose(),
		};
	} catch (error) { input.dispose(); throw error; }
}
