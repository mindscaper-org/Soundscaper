/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNote } from './midi-model.ts';
import {
	MIDI_FILE_MAX_BYTES, MIDI_FILE_MAX_EVENTS, MIDI_FILE_MAX_TRACKS,
	midiFileInteger, midiFileSampleRate, validateMidiFileDocument,
	type MidiFileDocument, type MidiFileEvent, type MidiFileReadOptions, type MidiFileSignature, type MidiFileTempo,
} from './midi-file-types.ts';
import { createMidiTempoTimeline } from './midi-file-timing.ts';
import { allegroDuration, allegroNumber, allegroPitch, allegroString, allegroTokens, allegroVelocity } from './allegro-file-fields.ts';
import { allegroAttributeToEvent, allegroEventFields } from './allegro-file-events.ts';

// Current Audacity/PortSMF Allegro grammar: numeric T/U values are seconds.
// https://github.com/rbdannenberg/portsmf/blob/master/allegrord.cpp
// This parser is independently implemented; no upstream source is copied.
interface AllegroTrack { name: string; notes: MidiNote[]; events: MidiFileEvent[] }
interface AllegroParseResult { readonly document: MidiFileDocument; readonly tempoDeclarations: readonly MidiFileTempo[] }

export function parseAllegroFile(text: string, options: MidiFileReadOptions = {}): MidiFileDocument {
	if (text.length > MIDI_FILE_MAX_BYTES || new TextEncoder().encode(text).length > MIDI_FILE_MAX_BYTES) throw new RangeError('Allegro file exceeds the 16 MiB import limit.');
	const sampleRate = midiFileSampleRate(options.sampleRate);
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	// Read the time map before notes, including files whose tempo declarations follow notes.
	const first = parseLines(lines, sampleRate, []);
	return parseLines(lines, sampleRate, first.tempoDeclarations).document;
}

function parseLines(lines: readonly string[], sampleRate: number, knownTempos: readonly MidiFileTempo[]): AllegroParseResult {
	const tracks = new Map<number, AllegroTrack>();
	const declarations: MidiFileTempo[] = [];
	const signatureParts = new Map<number, { numerator?: number; denominator?: number }>();
	const keySignatures = new Map<string, { frame: number; track: AllegroTrack; key: number; minor: boolean }>();
	let timing = createMidiTempoTimeline(knownTempos, sampleRate, 100);
	let trackIndex = 0;
	let currentFrame = 0;
	let pitch = 60;
	let velocity = 100;
	let channel = 0;
	let duration = sampleRate;
	let offset = 0;
	let offsetSeen = false;
	let noteCount = 0;
	let eventCount = 0;
	let beatAnchor = { frame: 0, beat: 0 };
	const ensureTrack = (): AllegroTrack => {
		let track = tracks.get(trackIndex);
		if (!track) { track = { name: `MIDI ${trackIndex + 1}`, notes: [], events: [] }; tracks.set(trackIndex, track); }
		return track;
	};
	for (const [lineIndex, raw] of lines.entries()) {
		const line = raw.trim();
		if (!line) continue;
		try {
			const header = /^#track\s+(\d+)(?:\s+(.*))?$/i.exec(line);
			if (header) {
				trackIndex = midiFileInteger(Number(header[1]), 0, MIDI_FILE_MAX_TRACKS - 1, 'Allegro track');
				if (header[2]) ensureTrack().name = header[2];
				else ensureTrack();
				continue;
			}
			const offsetMatch = /^#offset\s+(.+)$/i.exec(line);
			if (offsetMatch) {
				if (offsetSeen) throw new RangeError('Allegro offset is specified twice.');
				offsetSeen = true;
				offset = allegroNumber(offsetMatch[1]!, 'offset') * sampleRate;
				continue;
			}
			if (line.startsWith('#')) continue;
			const tokens = allegroTokens(line);
			if (!tokens.length) continue;
			if (++eventCount > MIDI_FILE_MAX_EVENTS) throw new RangeError('Allegro file contains too many events.');
			const track = ensureTrack();
			let isNote = false;
			let key: number | null = null;
			let next: number | null = null;
			const attributes = new Map<string, string>();
			const timeTokens = tokens.filter(token => /^T/i.test(token));
			if (timeTokens.length > 1) throw new RangeError('Allegro time is specified twice.');
			if (timeTokens[0]) currentFrame = allegroDuration(timeTokens[0].slice(1), 0, timing, sampleRate);
			for (const token of tokens) {
				const initial = token[0]!.toUpperCase();
				const value = token.slice(1);
				if (initial === 'T') continue;
				if (initial === '-') {
					const attribute = /^-([a-zA-Z][\da-zA-Z_]*):(.+)$/.exec(token);
					if (!attribute) throw new RangeError(`Invalid Allegro attribute: ${token}.`);
					attributes.set(attribute[1]!, attribute[2]!);
				} else if (initial === 'V') channel = value === '-' ? -1 : allegroNumber(value, 'channel');
				else if (initial === 'L') velocity = allegroVelocity(value);
				else if (initial === 'K') key = allegroPitch(value, pitch);
				else if (initial === 'N') next = allegroDuration(value, currentFrame, timing, sampleRate);
				else if (initial === 'P' || /^[A-G]$/.test(initial)) { pitch = allegroPitch(initial === 'P' ? value : token, pitch); isNote = true; }
				else if (initial === 'U' || /^[SIQHW]$/.test(initial)) { duration = allegroDuration(initial === 'U' ? value : token, currentFrame, timing, sampleRate); isNote = true; }
				else throw new RangeError(`Unknown Allegro field: ${token}.`);
			}
			if (key !== null && !isNote && !attributes.size && key < 128) { pitch = key; isNote = true; }
			for (const [name, value] of attributes) {
				if (name === 'tempor') {
					const bpm = allegroNumber(value, 'tempo');
					if (bpm <= 0 || bpm > 60_000_000) throw new RangeError('Invalid Allegro tempo.');
					declarations.push({ frame: Math.round(currentFrame), bpm });
					if (!knownTempos.length) timing = createMidiTempoTimeline(declarations, sampleRate, 100);
				} else if (name === 'beatr') {
					const beat = allegroNumber(value, 'beat anchor');
					if (currentFrame === 0 && beat === 0) continue;
					if (currentFrame <= beatAnchor.frame || beat <= beatAnchor.beat) throw new RangeError('Allegro beat anchors must increase in time and beat.');
					const bpm = (beat - beatAnchor.beat) / (currentFrame - beatAnchor.frame) * sampleRate * 60;
					declarations.push({ frame: Math.round(beatAnchor.frame), bpm });
					beatAnchor = { frame: currentFrame, beat };
					if (!knownTempos.length) timing = createMidiTempoTimeline(declarations, sampleRate, 100);
				} else if (name === 'timesig_numr' || name === 'timesig_denr') {
					const frame = Math.round(currentFrame);
					const parts = signatureParts.get(frame) ?? {};
					if (name === 'timesig_numr') parts.numerator = allegroNumber(value, 'signature numerator');
					else parts.denominator = allegroNumber(value, 'signature denominator');
					signatureParts.set(frame, parts);
				} else if (name === 'seqnames' || name === 'tracknames') track.name = allegroString(value);
				else if (name === 'keysigi' || name === 'modea') {
					const mapKey = `${trackIndex}:${currentFrame}`;
					const signature = keySignatures.get(mapKey) ?? { frame: Math.round(currentFrame), track, key: 0, minor: false };
					if (name === 'keysigi') signature.key = midiFileInteger(allegroNumber(value, 'key signature'), -7, 7, 'key signature');
					else { const mode = allegroString(value); if (mode !== 'major' && mode !== 'minor') throw new RangeError('Unsupported Allegro key mode.'); signature.minor = mode === 'minor'; }
					keySignatures.set(mapKey, signature);
				} else track.events.push(allegroAttributeToEvent(name, value, Math.round(currentFrame), channel, key));
			}
			if (isNote) {
				if (duration <= 0) throw new RangeError('Allegro note duration must be positive.');
				midiFileInteger(pitch, 0, 127, 'Allegro pitch (microtonal notes are unsupported)');
				midiFileInteger(channel, 0, 15, 'Allegro channel');
				midiFileInteger(Math.round(velocity), 0, 127, 'Allegro velocity');
				track.notes.push({ id: `allegro-${trackIndex}-${noteCount++}`, pitch, channel, velocity: Math.round(velocity),
					startFrame: Math.round(currentFrame), durationFrames: Math.max(1, Math.round(currentFrame + duration) - Math.round(currentFrame)) });
			}
			if (next !== null) currentFrame += next;
			else if (isNote) currentFrame += duration;
		} catch (error) {
			throw new RangeError(`Allegro line ${lineIndex + 1}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	}
	if (!tracks.size) throw new RangeError('Allegro file contains no tracks or events.');
	for (const signature of keySignatures.values()) signature.track.events.push({ frame: signature.frame, status: 255, metaType: 89, data: [signature.key & 255, signature.minor ? 1 : 0] });
	const tempos = declarations.length ? declarations : [{ frame: 0, bpm: 100 }];
	if (!tempos.some(tempo => tempo.frame === 0)) tempos.unshift({ frame: 0, bpm: 100 });
	const signatures: MidiFileSignature[] = [];
	for (const [frame, parts] of signatureParts) {
		if (!parts.numerator || !parts.denominator) throw new RangeError('Allegro time signature requires numerator and denominator.');
		signatures.push({ frame, numerator: parts.numerator, denominator: parts.denominator });
	}
	if (!signatures.some(signature => signature.frame === 0)) signatures.unshift({ frame: 0, numerator: 4, denominator: 4 });
	const document: MidiFileDocument = {
		sampleRate, tempos: tempos.sort((a, b) => a.frame - b.frame), signatures: signatures.sort((a, b) => a.frame - b.frame),
		tracks: [...tracks.entries()].sort(([a], [b]) => a - b).map(([, track]) => ({
			name: track.name,
			notes: track.notes.map(note => ({ ...note, startFrame: midiFileInteger(Math.round(note.startFrame + offset), 0, Number.MAX_SAFE_INTEGER, 'Allegro note time') })),
			...(track.events.length ? { events: track.events.map(event => ({ ...event, frame: midiFileInteger(Math.round(event.frame + offset), 0, Number.MAX_SAFE_INTEGER, 'Allegro event time') })) } : {}),
		})),
	};
	validateMidiFileDocument(document);
	return { document, tempoDeclarations: declarations };
}

export function writeAllegroFile(document: MidiFileDocument): string {
	validateMidiFileDocument(document);
	const lines = ['#offset 0'];
	const seconds = (frame: number): string => String(Number((frame / document.sampleRate).toFixed(10)));
	for (const [index, track] of document.tracks.entries()) {
		lines.push(`#track ${index} ${track.name.replace(/[\r\n]/g, ' ')}`);
		if (index === 0) {
			for (const tempo of document.tempos) lines.push(`T${seconds(tempo.frame)} -tempor:${tempo.bpm}`);
			for (const signature of document.signatures) lines.push(`T${seconds(signature.frame)} V- -timesig_numr:${signature.numerator} -timesig_denr:${signature.denominator}`);
		}
		const events: { frame: number; fields: string }[] = [];
		if (track.program !== undefined && !track.events?.some(event => (event.status & 240) === 192)) events.push({ frame: 0, fields: `V0 -programi:${track.program}` });
		for (const note of track.notes) events.push({ frame: note.startFrame, fields: `V${note.channel} K${note.pitch} P${note.pitch} U${seconds(note.durationFrames)} L${note.velocity}` });
		for (const event of track.events ?? []) events.push({ frame: event.frame, fields: allegroEventFields(event) });
		for (const event of events.sort((a, b) => a.frame - b.frame)) lines.push(`T${seconds(event.frame)} ${event.fields}`);
	}
	const text = `${lines.join('\n')}\n`;
	if (new TextEncoder().encode(text).length > MIDI_FILE_MAX_BYTES) throw new RangeError('Allegro export exceeds the 16 MiB limit.');
	return text;
}
