/* SPDX-License-Identifier: AGPL-3.0-only */
import { chaseMidiAudioEvents, midiAudioEvents } from './midi-audio-events.ts';
import type { MidiClipData } from '../midi-model.ts';
import type { MidiAudioRenderer } from './midi-demand-source.ts';

export interface MidiLibrarySynth {
	render(channels: Float32Array<ArrayBuffer>[]): void;
	send(bytes: readonly number[]): void;
	close(): void;
}

/** Keep controller ordering and sample-offset note dispatch identical for every library backend. */
export async function openMidiLibraryRenderer(data: MidiClipData, open: () => Promise<MidiLibrarySynth>, initialFrame = 0): Promise<MidiAudioRenderer> {
	const events = midiAudioEvents(data);
	const initialCursor = events.findIndex(event => event.frame >= initialFrame);
	const cursorAtStart = initialCursor < 0 ? events.length : initialCursor;
	const chased = initialFrame ? chaseMidiAudioEvents(events, initialFrame) : [];
	let synth = await open(), position = initialFrame, cursor = cursorAtStart;
	for (const event of chased) synth.send(event.data);
	const process = (frames: number): Float32Array<ArrayBuffer>[] => {
		const output = [new Float32Array(frames), new Float32Array(frames)];
		const end = position + frames;
		while (position < end) {
			while (cursor < events.length && events[cursor]!.frame <= position) synth.send(events[cursor++]!.data);
			const next = Math.min(end, events[cursor]?.frame ?? end);
			if (next > position) {
				const start = frames - (end - position);
				synth.render(output.map(plane => plane.subarray(start, start + next - position)));
				position = next;
			}
		}
		return output;
	};
	return { channelCount: 2, async render(start, frames) {
		if (start < initialFrame) throw new RangeError('MIDI read precedes its playback origin.');
		if (start < position) { synth.close(); synth = await open(); position = initialFrame; cursor = cursorAtStart; for (const event of chased) synth.send(event.data); }
		while (position < start) process(Math.min(1024, start - position));
		return process(frames);
	}, close: async () => { synth.close(); } };
}
