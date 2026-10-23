/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderClipNode, UnifiedExactRenderFinishingNode } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import type { VideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import { checkedFrame, mediaPresentation } from './selected-finishing-exact-frame-support.ts';

type Data = Readonly<Record<string, unknown>>;
interface MediaIndex {
	readonly clips: ReadonlyMap<string, UnifiedExactRenderClipNode>;
	readonly sourceIdByNodeId: ReadonlyMap<string, string>;
}

/** Validate one media occurrence against the same exact plan used for its mask. */
export function resolveSelectedFinishingMediaEntry(index: MediaIndex, entry: Data) {
	const clipId = entry.clipId;
	if (typeof clipId !== 'string' || clipId.length < 1 || clipId.length > 256) {
		throw new TypeError('Selected finishing media clip ID is invalid.');
	}
	const clip = index.clips.get(clipId);
	if (!clip) throw new ReferenceError(`Selected finishing clip ${clipId} is absent from its V13 plan.`);
	const sourceId = index.sourceIdByNodeId.get(clip.sourceNodeId);
	if (!sourceId || entry.sourceId !== sourceId) throw new Error(`Selected finishing clip ${clipId} changed source authority.`);
	const descriptor = record(entry.presentationDescriptor, 'Selected finishing media presentation');
	return { clipId, clip, sourceId,
		sourceFrame: frame(descriptor.drawableSourceFrame, 'Selected finishing drawable source frame'),
		outerCell: frame(descriptor.outerCell, 'Selected finishing outer cell') };
}

/** Bind raw video inputs before any graph executes; reuse each captured occurrence. */
export async function captureSelectedFinishingVideoMaskInputs(options: MediaIndex & Readonly<{
	readonly layers: readonly unknown[];
	readonly visualMasks: readonly VideoMaskMatteGraphV1[];
	readonly masks: ReadonlyMap<string, VideoMaskMatteGraphV1>;
	readonly finishing: UnifiedExactRenderFinishingNode;
	readonly inputs: Map<string, UnifiedExactRenderRgbaFrameV13>;
	readonly capture: (entry: Data, signal: AbortSignal) => UnifiedExactRenderRgbaFrameV13 | PromiseLike<UnifiedExactRenderRgbaFrameV13>;
	readonly signal: AbortSignal;
}>): Promise<ReadonlyMap<Data, UnifiedExactRenderRgbaFrameV13>> {
	const required = new Set(options.visualMasks.flatMap(graph => graph.inputs.map(input => input.sourceRef)));
	const entries = options.layers.flatMap(value => {
		const layer = record(value, 'Selected finishing media layer');
		if (!Array.isArray(layer.entries)) throw new TypeError('Selected finishing media entries must be an array.');
		return layer.entries.map(value => {
			const entry = record(value, 'Selected finishing media entry');
			const resolved = resolveSelectedFinishingMediaEntry(options, entry);
			for (const id of mediaPresentation(options.finishing, resolved.clipId, resolved.sourceId).maskIds) {
				const graph = options.masks.get(id);
				if (!graph) throw new ReferenceError(`Selected finishing mask ${id} is unavailable.`);
				for (const input of graph.inputs) required.add(input.sourceRef);
			}
			return { entry, ...resolved };
		});
	});
	const captures = new Map<Data, UnifiedExactRenderRgbaFrameV13>();
	const bound = new Map<string, Readonly<{ sourceFrame: number; pixels: UnifiedExactRenderRgbaFrameV13 }>>();
	for (const value of entries) {
		if (!required.has(value.sourceId)) continue;
		throwIfAborted(options.signal);
		let binding = bound.get(value.sourceId);
		if (binding && binding.sourceFrame !== value.sourceFrame) {
			throw new Error(`Mask/matte source ${value.sourceId} has ambiguous active source frames.`);
		}
		if (!binding) {
			const pixels = checkedFrame(await options.capture(value.entry, options.signal), 'Selected finishing mask input frame');
			throwIfAborted(options.signal);
			binding = { sourceFrame: value.sourceFrame, pixels };
			bound.set(value.sourceId, binding);
			options.inputs.set(value.sourceId, pixels);
		}
		captures.set(value.entry, binding.pixels);
	}
	return captures;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}
function frame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected finishing exact execution was aborted.', 'AbortError');
}
