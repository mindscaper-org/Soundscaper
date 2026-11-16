/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiRenderer } from './midi-synthesis.ts';
import type { MidiClipData, MidiInstrument } from '../midi-model.ts';

export interface MidiRenderWorkerRequest {
	readonly id: string;
	readonly data?: MidiClipData;
	readonly instrument?: MidiInstrument;
	readonly sampleRate?: number;
	readonly start?: number;
	readonly frames?: number;
}
/** Kept independent of worker globals so a real worker can be profiled in Node too. */
export function createMidiRenderWorker() {
	let render: ReturnType<typeof createMidiRenderer> | null = null;
	return (request: MidiRenderWorkerRequest) => {
		if (request.data && request.instrument && request.sampleRate) {
			render = createMidiRenderer(request.data.notes, request.instrument, request.sampleRate, request.data.interchange?.events);
			return { id: request.id, channelCount: 1 };
		}
		if (!render) throw new Error('MIDI rendering worker is not initialized.');
		return { id: request.id, channels: [render(request.start!, request.frames!)] };
	};
}
