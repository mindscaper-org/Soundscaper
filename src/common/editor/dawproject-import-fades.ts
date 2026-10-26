/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateClipTransitionGainAt } from './audio-clip-transition-gain.ts';
import { envelopeValueAtFrame } from './automation.js';
import type { DawprojectAudioEvent } from './dawproject-import-timeline.ts';

export interface DawprojectFadeLayer {
	readonly startFrame: number;
	readonly endFrame: number | null;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
}

/** Preserve fade phase and content stops while retaining the parent clip extent. */
export function dawprojectImportedClipFades(event: DawprojectAudioEvent, startFrame: number, durationFrames: number) {
	const fades = importedClipFades(event, startFrame, durationFrames);
	const stop = event.contentStopFrame;
	if (stop === undefined || stop === null || stop >= startFrame + durationFrames) return fades;
	const frame = Math.max(0, stop - startFrame);
	const envelope = (fades.envelope ?? []).filter(point => point.frame < frame - 1);
	if (frame > 0) envelope.push({ frame: frame - 1,
		value: Number(envelopeValueAtFrame(fades.envelope ?? [], frame - 1, durationFrames)) });
	envelope.push({ frame, value: 0 }, { frame: durationFrames, value: 0 });
	return { ...fades, envelope };
}

function importedClipFades(event: DawprojectAudioEvent, startFrame: number, durationFrames: number) {
	const layers = (event.fadeLayers ?? [event]).map((layer) => ({
		...layer, endFrame: layer.endFrame ?? event.endFrame,
		fadeInFrames: Math.min((layer.endFrame ?? event.endFrame) - layer.startFrame, Math.max(0, layer.fadeInFrames)),
		fadeOutFrames: Math.min((layer.endFrame ?? event.endFrame) - layer.startFrame, Math.max(0, layer.fadeOutFrames)),
	})).filter((layer) => layer.fadeInFrames || layer.fadeOutFrames);
	if (!layers.length) return { fadeInFrames: 0, fadeOutFrames: 0 };
	const first = layers[0]!;
	if (layers.length === 1 && startFrame === first.startFrame && durationFrames === first.endFrame - first.startFrame) {
		return { fadeInFrames: first.fadeInFrames, fadeOutFrames: first.fadeOutFrames };
	}
	const valueAt = (frame: number): number => layers.reduce((gain, layer) => gain * evaluateClipTransitionGainAt(
		startFrame + frame - layer.startFrame, layer.endFrame - layer.startFrame, {
			fadeInFrames: layer.fadeInFrames, fadeOutFrames: layer.fadeOutFrames, crossfadeInRanges: [], crossfadeOutRanges: [],
		}), 1);
	const frames = new Set([0, durationFrames]);
	for (const boundary of layers.flatMap((layer) => [layer.startFrame + layer.fadeInFrames, layer.endFrame - layer.fadeOutFrames])) {
		const frame = boundary - startFrame;
		if (frame > 0 && frame < durationFrames) frames.add(frame);
	}
	const boundaries = [...frames].sort((left, right) => left - right);
	for (let index = 1; index < boundaries.length; index += 1) subdivide(boundaries[index - 1]!, boundaries[index]!);
	return { fadeInFrames: 0, fadeOutFrames: 0,
		envelope: [...frames].sort((left, right) => left - right).map((frame) => ({ frame, value: valueAt(frame) })) };

	function subdivide(left: number, right: number): void {
		const middle = Math.floor((left + right) / 2);
		if (middle <= left || middle >= right || frames.size >= 4096) return;
		const linear = valueAt(left) + (valueAt(right) - valueAt(left)) * (middle - left) / (right - left);
		if (Math.abs(valueAt(middle) - linear) <= 0.00001) return;
		frames.add(middle); subdivide(left, middle); subdivide(middle, right);
	}
}
