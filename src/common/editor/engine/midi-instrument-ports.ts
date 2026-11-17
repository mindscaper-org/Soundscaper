/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiClipData, MidiNote } from '../midi-model.ts';
import type { MidiFileEvent } from '../midi-file-types.ts';
import type { MidiAudioRenderer } from './midi-demand-source.ts';

/** Each SMF port owns a separate set of sixteen channels, including its controllers. */
export function splitMidiInstrumentPorts(data: MidiClipData): readonly MidiClipData[] {
	const input = data.interchange?.events ?? [];
	if (data.notes.every(note => !note.midiPort) && !input.some(isPortSelector)) return [data];
	const events = [...input].sort((a, b) => a.frame - b.frame);
	const selectors: { frame: number; port: number }[] = [];
	const byPort = new Map<number, typeof events>();
	let port = 0;
	for (const event of events) {
		if (isPortSelector(event)) {
			port = event.data[0]!; selectors.push({ frame: event.frame, port });
		} else {
			const group = byPort.get(port) ?? []; group.push(event); byPort.set(port, group);
		}
	}
	const notes = new Map<number, MidiNote[]>();
	for (const note of data.notes) {
		let low = 0, high = selectors.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (selectors[middle]!.frame <= note.startFrame) low = middle + 1; else high = middle;
		}
		const destination = note.midiPort ?? selectors[low - 1]?.port ?? 0;
		const group = notes.get(destination) ?? []; group.push({ ...note, midiPort: 0 }); notes.set(destination, group);
	}
	return [...notes.size ? notes : new Map([[0, [] as MidiNote[]]])].map(([destination, keys]) => ({ ...data, notes: keys,
		interchange: { tempos: data.interchange?.tempos ?? [], signatures: data.interchange?.signatures ?? [], events: byPort.get(destination) ?? [] } }));
}

function isPortSelector(event: MidiFileEvent): boolean {
	return event.status === 255 && event.metaType === 0x21 && event.data.length === 1;
}

export async function openMidiPortRenderers<Part>(parts: readonly Part[], open: (data: Part) => Promise<MidiAudioRenderer>): Promise<MidiAudioRenderer> {
	const renderers: MidiAudioRenderer[] = [];
	try { for (const part of parts) renderers.push(await open(part)); }
	catch (error) { await Promise.allSettled(renderers.map(renderer => renderer.close())); throw error; }
	const channelCount = Math.max(...renderers.map(renderer => renderer.channelCount));
	return { channelCount, async render(start, frames) {
		const output = Array.from({ length: channelCount }, () => new Float32Array(frames));
		for (const renderer of renderers) {
			const planes = await renderer.render(start, frames);
			for (const [channel, plane] of planes.entries()) for (let frame = 0; frame < frames; frame++) output[channel]![frame]! += plane[frame]!;
		}
		return output;
	}, async close() {
		const results = await Promise.allSettled(renderers.map(renderer => renderer.close()));
		const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'MIDI port renderer cleanup failed.');
	} };
}
