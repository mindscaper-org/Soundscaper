/* SPDX-License-Identifier: AGPL-3.0-only */
import { createOmfExport } from '../../src/common/editor/omf-export.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

export function omfCompositionClockBytes(compositionRate: number, sourceRate: number): Uint8Array {
	const wave = encodeWav([new Float32Array(sourceRate).fill(.25)], { sampleRate: sourceRate, float: true });
	return createOmfExport({ project: { title: 'Native source clocks', sampleRate: compositionRate,
		sources: [{ id: 'voice', kind: 'audio', name: 'Voice.wav', frameCount: sourceRate, sampleRate: sourceRate, channelCount: 1, sampleFormat: 'float32' }],
		clips: [{ id: 'cut', kind: 'audio', sourceId: 'voice', timelineStartFrame: 1, sourceStartFrame: sourceRate / 10, durationFrames: compositionRate / 10 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Voice', clipIds: ['cut'] }] }, media: new Map([['voice', Uint8Array.from(wave)]]) }).bytes;
}
