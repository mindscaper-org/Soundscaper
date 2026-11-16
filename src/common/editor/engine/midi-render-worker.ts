/* SPDX-License-Identifier: AGPL-3.0-only */
import { openMidiAudioRenderer } from './midi-audio-renderer.ts';
import { compileMidiAudioTimeline } from './midi-audio-events.ts';
import type { MidiClipData, MidiInstrument } from '../midi-model.ts';

export interface MidiRenderWorkerRequest {
	readonly id: string;
	readonly data?: MidiClipData;
	readonly instrument?: MidiInstrument;
	readonly sampleRate?: number;
	readonly start?: number;
	readonly frames?: number;
	readonly initialFrame?: number;
	readonly eventsOnly?: boolean;
}
/** Kept independent of worker globals so a real worker can be profiled in Node too. */
export function createMidiRenderWorker() {
	let render: Awaited<ReturnType<typeof openMidiAudioRenderer>> | null = null;
	return async (request: MidiRenderWorkerRequest) => {
		if (request.eventsOnly && request.data) return { id: request.id, timeline: compileMidiAudioTimeline(request.data, request.initialFrame) };
		if (request.data && request.instrument && request.sampleRate) {
			await render?.close();
			render = await openMidiAudioRenderer(request.data, request.instrument, request.sampleRate, request.initialFrame);
			return { id: request.id, channelCount: render.channelCount };
		}
		if (!render) throw new Error('MIDI rendering worker is not initialized.');
		return { id: request.id, channels: await render.render(request.start!, request.frames!) };
	};
}
