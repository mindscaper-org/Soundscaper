/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseMidiFile } from './midi-file.ts';
import { MIDI_FILE_MAX_EVENTS } from './midi-file-types.ts';
import { normalizeMidiClipData, type MidiClipData, type MidiInstrument } from './midi-model.ts';
import { createInterchangeMidiClock } from './interchange-midi-clock.ts';
import { addRationals, multiplyRationals, roundRational } from './timeline-time.ts';
import type { TimelineInterchangeDocument, TimelineInterchangeMedia } from './timeline-interchange-types.ts';

interface MidiImportOptions {
	readonly createStableId: (prefix: string) => string;
	readonly media?: ReadonlyMap<string, Readonly<Record<string, unknown>> | null>;
	readonly midiFiles?: ReadonlyMap<string, Uint8Array>;
}

export interface TimelineInterchangeMidiSource {
	readonly sourceId: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly instrument: MidiInstrument;
	readonly data: MidiClipData;
}

/** Give each MIDI region its own immutable source: its placement owns the tempo projection. */
export function prepareTimelineInterchangeMidi(document: TimelineInterchangeDocument, options: MidiImportOptions, sampleRate: number) {
	const media = new Map(options.media);
	const references: TimelineInterchangeMedia[] = [];
	const resolved = new Set<string>();
	const midiSources: TimelineInterchangeMidiSource[] = [];
	let eventCount = 0;
	const tracks = document.tracks.map(track => ({ ...track, clips: track.clips.map(clip => {
		let data = clip.midi;
		const bytes = options.midiFiles?.get(clip.mediaId), timing = clip.midiFileTiming;
		if (!data && bytes && timing) {
			const clock = createInterchangeMidiClock(timing.tempos), origin = clock.atBeat(timing.sourceBeat);
			const parsed = parseMidiFile(bytes, { sampleRate, tickToFrame: (tick, ppq) => clock.frameAt(timing.sourceBeat + tick / ppq, sampleRate, origin) });
			if (parsed.tracks.length !== 1) throw new RangeError('Ardour MIDI sources require one SMF track.');
			data = normalizeMidiClipData({ version: 1, notes: parsed.tracks[0]!.notes,
				interchange: { events: parsed.tracks[0]!.events ?? [], tempos: [], signatures: [] } });
		} else if (data && sampleRate !== document.sampleRate) {
			const frame = (value: number) => roundRational(BigInt(value) * BigInt(sampleRate), BigInt(document.sampleRate), 'point');
			data = normalizeMidiClipData({ ...data, notes: data.notes.map(note => ({ ...note, startFrame: frame(note.startFrame),
				durationFrames: Math.max(1, frame(note.startFrame + note.durationFrames) - frame(note.startFrame)) })),
				...(data.interchange ? { interchange: { ...data.interchange, events: data.interchange.events.map(event => ({ ...event, frame: frame(event.frame) })) } } : {}) });
		}
		if (!data) return clip;
		eventCount += data.notes.length + (data.interchange?.events.length ?? 0);
		if (eventCount > MIDI_FILE_MAX_EVENTS) throw new RangeError('Session MIDI exceeds the editable event limit.');
		resolved.add(clip.mediaId);
		const id = options.createStableId('source');
		const extent = multiplyRationals(addRationals(clip.sourceStart, clip.duration), sampleRate);
		let frameCount = Math.max(1, roundRational(extent.num, extent.den, 'enclosingEnd'));
		for (const note of data.notes) frameCount = Math.max(frameCount, note.startFrame + note.durationFrames);
		for (const event of data.interchange?.events ?? []) frameCount = Math.max(frameCount, event.frame + 1);
		midiSources.push({ sourceId: id, data, instrument: 'triangle', sampleRate, frameCount });
		media.set(id, { id, kind: 'audio', storageKey: id, name: clip.name, mimeType: 'audio/wav', sampleRate, frameCount, channelCount: 1 });
		references.push({ id, path: '', name: clip.name, kind: 'audio' });
		return { ...clip, mediaId: id, midi: data };
	}) }));
	return { document: { ...document, tracks, media: [...document.media.filter(item => !resolved.has(item.id)), ...references] }, media, midiSources };
}
