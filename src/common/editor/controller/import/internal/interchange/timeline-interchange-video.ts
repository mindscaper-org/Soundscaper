/* SPDX-License-Identifier: AGPL-3.0-only */

import { probeVideoTiming, type ResolvedVideoTimingProbe } from '../../../../video-timing-probe.ts';
import { createContainerVideoTimingProbe } from '../../../../video-timing-demux.ts';
import { publishVideoTimingAsset, type VideoTimingMediaStore } from '../../../../video-timing-storage.ts';
import { acquireVideoTimingIndex } from '../../../../video-source-time.ts';
import { roundRational } from '../../../../timeline-time.ts';
import { normalizeVideoSourceCharacteristics } from '../../../../video-source-characteristics.ts';
import { publishImportedVideo } from '../source-import-video-publication.ts';
import type { TimelineInterchangeMedia } from '../../../../timeline-interchange-types.ts';
import type { NativeProjectStore } from '../../../document/native-project-types.ts';
import type { VideoTimingIndex } from '../../../../video-timing-asset.ts';

export type TimelineInterchangeFinalizer = (committed: boolean) => PromiseLike<void> | void;
interface VideoExtractor {
	readonly metadata: Readonly<{ width: number; height: number; durationSeconds: number }>;
	dispose(): void;
}
interface VideoPorts {
	probe(blob: Blob, options: Readonly<{ signal: AbortSignal }>): PromiseLike<ResolvedVideoTimingProbe>;
	extract(blob: Blob, options: Readonly<{ signal: AbortSignal; timing: VideoTimingIndex }>): PromiseLike<VideoExtractor>;
}
interface VideoRequest {
	readonly store: Pick<NativeProjectStore, 'beginMediaAssetWrite' | 'getMediaAssetMetadata' | 'loadMediaAsset'>;
	readonly blob: Blob;
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly reference: TimelineInterchangeMedia;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly preflightStorage: (bytes: number, purpose: 'import') => PromiseLike<unknown>;
	readonly stagedIds: string[];
	readonly finalizers: TimelineInterchangeFinalizer[];
}

const DEFAULT_PORTS: VideoPorts = {
	probe: (blob, options) => probeVideoTiming(blob, { probes: [createContainerVideoTimingProbe()], signal: options.signal }),
	async extract(blob, options) {
		const { createAudioEditorVideoFrameExtractor } = await import('../../../../video-media.js');
		return createAudioEditorVideoFrameExtractor(blob, options);
	},
};

/** Publish the original and its verified source clock before constructing any clip. */
export async function stageTimelineInterchangeVideo(request: VideoRequest, ports: VideoPorts = DEFAULT_PORTS): Promise<Readonly<Record<string, unknown>> | null> {
	const { store, blob, reference, sourceId, sampleRate, signal, assertCurrent } = request;
	if (!store.beginMediaAssetWrite || !store.getMediaAssetMetadata || !store.loadMediaAsset) return null;
	signal.throwIfAborted();
	const probe = await ports.probe(blob, { signal });
	assertCurrent();
	if (probe.decision !== 'timing-asset') return null;
	let extractor: VideoExtractor;
	try { extractor = await ports.extract(blob, { signal, timing: probe.timing }); }
	catch { signal.throwIfAborted(); assertCurrent(); return null; }
	try {
		assertCurrent();
		await request.preflightStorage(blob.size + 32 + probe.timing.frameCount * 8, 'import');
		assertCurrent();
		const timingStore: VideoTimingMediaStore = {
			beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
			getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
			loadMediaAsset: key => store.loadMediaAsset!(key),
		};
		const original = await publishImportedVideo(timingStore, sourceId, blob,
			{ name: reference.name, mimeType: blob.type || 'video/mp4', width: extractor.metadata.width, height: extractor.metadata.height }, signal);
		request.stagedIds.push(sourceId);
		assertCurrent();
		const timing = await publishVideoTimingAsset(timingStore, original.sha256, probe.timing, { signal });
		let release: () => void = () => undefined;
		request.finalizers.push(async committed => {
			release();
			if (!committed) await timing.publication?.discardIfCurrent();
		});
		const source: Readonly<Record<string, unknown>> = {
			kind: 'video', id: sourceId, storageKey: sourceId, name: reference.name,
			mimeType: blob.type || 'video/mp4', contentSha256: original.sha256,
			width: extractor.metadata.width, height: extractor.metadata.height, sampleRate,
			sampleFrameCount: Math.max(1, roundRational(probe.timing.endTicks * BigInt(sampleRate), BigInt(probe.timing.timescale), 'point')),
			frameRate: probe.nominalRate, sourceFrameCount: probe.timing.frameCount,
			timingAsset: timing.reference, timingDecision: { mode: 'exact', rate: probe.nominalRate, backend: probe.backend },
			characteristics: normalizeVideoSourceCharacteristics({ ...probe.characteristics, extractedAudioStreamIndex: null }, { rate: probe.nominalRate }),
			videoCodec: probe.characteristics.videoCodec ?? 'unknown', hasAudio: false, audioCodec: null,
		};
		assertCurrent();
		const lease = acquireVideoTimingIndex(source, timing.index);
		release = () => { lease.release(); };
		return source;
	} finally { extractor.dispose(); }
}
