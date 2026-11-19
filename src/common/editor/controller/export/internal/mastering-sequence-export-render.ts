/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createMasteringSequenceOutput,
	writeMasteringSequenceEntry,
} from '../../../mastering-sequence-render.ts';
import type { MasteringSequenceDeliveryPlan, MasteringSequenceDeliverySegment } from '../../../mastering-sequence-delivery.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface RenderedBuffer {
	readonly sampleRate: number;
}

export interface MasteringSequenceExportRenderRuntime {
	audioBufferChannels(buffer: unknown): readonly Float32Array[];
	readonly copy: Readonly<Record<string, unknown>>;
	renderSnapshot(
		snapshot: RenderedBuffer,
		range: Readonly<{
			readonly endFrame: number;
			readonly includeTail: number | false;
			readonly outputFrames: number;
			readonly preRollFrames: number;
			readonly startFrame: number;
		}>,
		sourceMap: unknown,
		signal: AbortSignal,
		chunkSources: unknown | null,
		prepareTimePitchCaches: boolean,
	): Awaitable<RenderedBuffer>;
	resampleBuffer(
		input: RenderedBuffer,
		sampleRate: number,
		context: undefined,
		copy: Readonly<Record<string, unknown>>,
		outputFrames: number,
	): Awaitable<RenderedBuffer>;
	throwIfAborted(signal: AbortSignal): void;
	readonly taskProgress?: Readonly<{
		setActivePhase?(label: unknown, progress: Readonly<{
			readonly end: number;
			readonly start: number;
			readonly value: number;
		}>, localization?: import('../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): unknown;
	}>;
}

export interface MasteringSequenceExportRenderOptions {
	readonly channelCount: number;
	readonly chunkSources: unknown | null;
	readonly deliveryPlan: MasteringSequenceDeliveryPlan;
	readonly outputSampleRate: number;
	readonly prepareTimePitchCaches: boolean;
	readonly progressRange: Readonly<{ readonly end: number; readonly start: number }>;
	readonly renderSampleRate: number;
	readonly signal: AbortSignal;
	readonly snapshot: RenderedBuffer;
	readonly sourceMap: unknown;
}

/** Planar PCM the ordinary encoder accepts, already in the delivered rate. */
export interface MasteringSequenceRenderedDelivery {
	readonly channels: readonly Float32Array[];
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	/**
	 * Answers channels the way an AudioBuffer does.
	 *
	 * The encode path reads the delivered audio through `audioBufferChannels`,
	 * which calls this rather than reaching into `channels`. Leaving it off the
	 * type is what let a bare planar record satisfy the compiler and then throw
	 * at the encoder after a full render.
	 */
	getChannelData(channel: number): Float32Array;
}

/**
 * Performing a mastering-sequence delivery with the ordinary offline render.
 *
 * Each entry is rendered by exactly the call every other export makes — the same
 * engine, over its own region's range — and the results are placed into the
 * delivered timeline. There is no second renderer: this decides *what* to render
 * and *where it lands*, never how a frame is produced, which is what keeps a
 * sequence delivery identical to playing those regions back in that order.
 *
 * A region named twice is rendered once. The assembler is proven not to mutate
 * what it copies from, so a reprise costs an arrangement rather than a second
 * pass over the same audio — and rendering it twice could not differ anyway
 * without breaking the identity between playback and delivery.
 */
export async function renderMasteringSequenceExport(
	runtime: MasteringSequenceExportRenderRuntime,
	options: MasteringSequenceExportRenderOptions,
): Promise<MasteringSequenceRenderedDelivery> {
	const { copy, taskProgress } = runtime;
	const { deliveryPlan, outputSampleRate } = options;
	const total = deliveryPlan.segments.length;
	const span = options.progressRange.end - options.progressRange.start;
	let output: readonly Float32Array[] | undefined;
	let completed = 0;

	for (const entries of groupRegions(deliveryPlan.segments)) {
		runtime.throwIfAborted(options.signal);
		taskProgress?.setActivePhase?.(copy.rendering, {
			start: options.progressRange.start,
			end: options.progressRange.end,
			value: span > 0 ? completed / total : 0,
		}, { key: 'rendering' });
		output = await renderRegionIntoOutput(runtime, options, entries, output);
		completed += entries.length;
	}

	const channels = output ?? createMasteringSequenceOutput(deliveryPlan.totalFrames, Math.max(1, options.channelCount));
	// Read like any other rendered buffer. The encode path takes the delivered
	// audio through `audioBufferChannels`, which asks a buffer for its channels
	// the way an AudioBuffer answers; a bare planar record satisfies the type but
	// not the call, so the delivery rendered in full and then threw at the encoder.
	return Object.freeze({
		channels,
		length: deliveryPlan.totalFrames,
		numberOfChannels: channels.length,
		sampleRate: outputSampleRate,
		getChannelData(channel: number): Float32Array {
			const data = channels[channel];
			if (!data) throw new RangeError(`The delivered sequence has no channel ${channel}.`);
			return data;
		},
	});
}

async function renderRegionIntoOutput(
	runtime: MasteringSequenceExportRenderRuntime,
	options: MasteringSequenceExportRenderOptions,
	entries: readonly MasteringSequenceDeliverySegment[],
	output: readonly Float32Array[] | undefined,
): Promise<readonly Float32Array[]> {
	const { audioBufferChannels, copy, renderSnapshot, resampleBuffer, throwIfAborted } = runtime;
	const { deliveryPlan, outputSampleRate, renderSampleRate, signal, snapshot } = options;
	const segment = entries[0]!;
	const rendered = await renderSnapshot(snapshot, {
		startFrame: segment.sourceStartFrame,
		endFrame: segment.sourceEndFrame,
		includeTail: false,
		outputFrames: segment.sourceEndFrame - segment.sourceStartFrame,
		preRollFrames: Math.min(segment.sourceStartFrame, renderSampleRate * 10),
	}, options.sourceMap, signal, options.chunkSources, options.prepareTimePitchCaches);
	throwIfAborted(signal);
	// Resampling to the delivered extent keeps the cue aligned with this region.
	const delivered = rendered.sampleRate === outputSampleRate
		? rendered
		: await resampleBuffer(rendered, outputSampleRate, undefined, copy, segment.outputEndFrame - segment.outputStartFrame);
	throwIfAborted(signal);
	const channels = audioBufferChannels(delivered);
	const target = output ?? createMasteringSequenceOutput(deliveryPlan.totalFrames, channels.length);
	// Entries occupy disjoint spans. One render supplies every reprise before
	// this call releases the temporary PCM and returns the assembled output.
	for (const entry of entries) {
		throwIfAborted(signal);
		writeMasteringSequenceEntry(target, entry, channels);
	}
	return target;
}

function groupRegions(segments: readonly MasteringSequenceDeliverySegment[]): Iterable<MasteringSequenceDeliverySegment[]> {
	const groups = new Map<string, MasteringSequenceDeliverySegment[]>();
	for (const segment of segments) {
		const key = `${segment.sourceStartFrame}:${segment.sourceEndFrame}:${segment.outputEndFrame - segment.outputStartFrame}`;
		const group = groups.get(key);
		if (group) group.push(segment);
		else groups.set(key, [segment]);
	}
	return groups.values();
}
