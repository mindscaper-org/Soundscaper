/* SPDX-License-Identifier: AGPL-3.0-only */
import { chaseMidiAudioEvents, firstMidiAudioEventAtOrAfter, midiAudioEvents } from './midi-audio-events.ts';
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
	const cursorAtStart = firstMidiAudioEventAtOrAfter(events, initialFrame);
	const chased = initialFrame ? chaseMidiAudioEvents(events, initialFrame) : [];
	let synth = await open(), position = initialFrame, cursor = cursorAtStart;
	let discard: Float32Array<ArrayBuffer>[] | undefined;
	for (const event of chased) synth.send(event.data);
	const process = (frames: number, output: Float32Array<ArrayBuffer>[]): void => {
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
	};
	return { channelCount: 2, async render(start, frames) {
		if (start < initialFrame) throw new RangeError('MIDI read precedes its playback origin.');
		if (start < position) { synth.close(); synth = await open(); position = initialFrame; cursor = cursorAtStart; for (const event of chased) synth.send(event.data); }
		while (position < start) {
			const count = Math.min(1024, start - position);
			discard ??= [new Float32Array(1024), new Float32Array(1024)];
			for (const plane of discard) plane.fill(0, 0, count);
			process(count, discard);
		}
		const output = [new Float32Array(frames), new Float32Array(frames)];
		process(frames, output);
		return output;
	}, close: async () => { synth.close(); } };
}
