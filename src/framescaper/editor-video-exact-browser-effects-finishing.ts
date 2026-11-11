/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import { resolveVideoRenderDescription } from '../common/editor/video-render-description.ts';

interface EffectSurface {
	readonly source: HTMLCanvasElement;
	readonly context: CanvasRenderingContext2D;
	readonly compositor: ReturnType<typeof import('../common/editor/ui/video-preview-compositor.js')['createVideoPreviewCompositor']>;
}
const surfaces = new WeakMap<Document, EffectSurface>();

/** Execute maintained browser effects over straight RGBA without changing transfer encoding. */
export async function applyVideoExactBrowserEffectsFinishing(
	frame: UnifiedExactRenderRgbaFrameV13,
	effects: readonly unknown[],
	signal: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	if (effects.length === 0) return clone(frame);
	if (!globalThis.document?.createElement) {
		throw new Error('Selected finishing browser effects are unavailable outside a WebGL2 document.');
	}
	const module = await import('../common/editor/ui/video-preview-compositor.js');
	throwIfAborted(signal);
	let surface = surfaces.get(globalThis.document);
	if (!surface) {
		const source = globalThis.document.createElement('canvas');
		const context = source.getContext('2d');
		if (!context) throw new Error('Selected finishing browser effect source has no 2D context.');
		const compositor = module.createVideoPreviewCompositor(globalThis.document.createElement('canvas'));
		surface = { source, context, compositor };
		surfaces.set(globalThis.document, surface);
	}
	// Rendering and capture below are synchronous, so concurrent async callers
	// share this document-owned context without interleaving frame contents.
	const { source, context, compositor } = surface;
	source.width = frame.width;
	source.height = frame.height;
	context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
	try {
		const report = compositor.render([{
			trackId: 'finishing-exact-effect-track', trackIndex: 0,
			entries: [{
				clipId: 'finishing-exact-effect-source',
				video: { drawable: source, videoWidth: frame.width, videoHeight: frame.height,
					readyState: 4, currentTime: 0, pause() {} },
				effects, opacity: 1, displayWidth: frame.width, displayHeight: frame.height,
				renderDescription: resolveVideoRenderDescription({
					composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
					sourceDisplaySize: { width: frame.width, height: frame.height },
					canvas: { width: frame.width, height: frame.height }, opacityStart: 1,
				}),
			}],
		}], {
			referenceWidth: frame.width, referenceHeight: frame.height,
			outputWidth: frame.width, outputHeight: frame.height,
			backgroundColor: '#00000000', outputColorModel: 'rgba',
		});
		if (report.status !== 'rendered' || report.rendererStatus !== 'available'
			|| report.renderedEntryCount !== 1 || report.effects.omitted.length !== 0
			|| report.effects.fallbackRendered.length !== 0) {
			throw new Error('Selected finishing browser effect execution omitted authored state.');
		}
		const captured = compositor.captureEvaluatedRgba();
		if (!captured || captured.width !== frame.width || captured.height !== frame.height
			|| captured.rgba.byteLength !== frame.pixels.byteLength) {
			throw new RangeError('Selected finishing browser effect output geometry changed.');
		}
		throwIfAborted(signal);
		return Object.freeze({
			width: captured.width, height: captured.height,
			pixels: captured.rgba.slice() as Uint8Array<ArrayBuffer>,
		});
	} catch (error) {
		surfaces.delete(globalThis.document);
		compositor.dispose();
		throw error;
	}
}

function clone(frame: UnifiedExactRenderRgbaFrameV13): UnifiedExactRenderRgbaFrameV13 {
	return Object.freeze({ width: frame.width, height: frame.height, pixels: frame.pixels.slice() });
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Selected finishing effects were cancelled.', 'AbortError');
}
