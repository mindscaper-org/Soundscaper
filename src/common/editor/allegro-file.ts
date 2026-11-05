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
import { offsetAllegroFrame, offsetAllegroNotes, offsetAllegroTiming } from './allegro-file-offset.ts';
import { allegroTempoDeclarations, type AllegroBeatAnchor, type AllegroTempoDeclaration } from './allegro-file-anchors.ts';
import { sameAllegroTempoClock } from './allegro-file-tempo-clock.ts';

// Current Audacity/PortSMF Allegro grammar: numeric T/U values are seconds.
// https://github.com/rbdannenberg/portsmf/blob/master/allegrord.cpp
// This parser is independently implemented; no upstream source is copied.
// Local coordinates remain unquantized until the track offset has been applied.
interface AllegroTrack { name: string; notes: MidiNote[]; events: MidiFileEvent[] }
interface AllegroParseResult { readonly document: MidiFileDocument | null; readonly tempoDeclarations: readonly MidiFileTempo[] }

export function parseAllegroFile(text: string, options: MidiFileReadOptions = {}): MidiFileDocument {
	if (text.length > MIDI_FILE_MAX_BYTES || new TextEncoder().encode(text).length > MIDI_FILE_MAX_BYTES) throw new RangeError('Allegro file exceeds the 16 MiB import limit.');
	const sampleRate = midiFileSampleRate(options.sampleRate);
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	// Read the time map before notes, including files whose tempo declarations follow notes.
	const first = parseLines(lines, sampleRate, [], false);
	const final = parseLines(lines, sampleRate, first.tempoDeclarations, true).document;
	if (!final) throw new Error('Allegro materialization produced no document.');
	return final;
}

function parseLines(lines: readonly string[], sampleRate: number, knownTempos: readonly MidiFileTempo[], materialize: boolean): AllegroParseResult {
	const deferBeatTempoFrames = !materialize && !lines.some(line => line.includes('-beatr:'));
	const tracks = new Map<number, AllegroTrack>();
	const declarations: AllegroTempoDeclaration[] = [];
	const beatAnchors: AllegroBeatAnchor[] = [];
	let declarationOrder = 0;
	const signatureParts = new Map<number, { numerator?: number; denominator?: number }>();
	const keySignatures = new Map<string, { frame: number; track: AllegroTrack; key: number; minor: boolean }>();
	let resolvedTiming = createMidiTempoTimeline(knownTempos, sampleRate, 100);
	let timingDirty = false;
	const currentTiming = () => {
		if (timingDirty) {
			resolvedTiming = createMidiTempoTimeline(allegroTempoDeclarations(declarations, beatAnchors, sampleRate), sampleRate, 100);
			timingDirty = false;
		}
		return resolvedTiming;
	};
	const timing = {
		frameToBeat: (frame: number) => currentTiming().frameToBeat(frame),
		beatToFrame: (beat: number) => currentTiming().beatToFrame(beat),
	};
	let trackIndex = 0;
	let currentFrame = 0;
	let currentBeat: number | null = null;
	let pitch = 60;
	let velocity = 100;
	let channel = 0;
	let duration = sampleRate;
	let offset = 0;
	let offsetSeen = false;
	let noteCount = 0;
	let eventCount = 0;
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
			if (timeTokens[0]) {
				const position = timeTokens[0].slice(1);
				currentBeat = position.split('+').every(term => /^[SIQHW]/i.test(term))
					? allegroDuration(position, 0, { frameToBeat: value => value, beatToFrame: value => value }, 1) : null;
				// Discovery retains the beat itself; repeated provisional-map rebuilds
				// cannot improve that declaration's final position.
				currentFrame = deferBeatTempoFrames && currentBeat !== null && tokens.some(token => token.startsWith('-tempor:'))
					? currentBeat * sampleRate * 0.6 : allegroDuration(position, 0, timing, sampleRate);
			}
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
			if (key !== null && !isNote && key < 128) { pitch = key; isNote = true; }
			if (isNote && [...attributes.keys()].some(name => name !== 'tempor' && name !== 'beatr')) {
				throw new RangeError('Note-attached Allegro attributes cannot be retained as MIDI channel updates. Use separate update lines.');
			}
			for (const [name, value] of attributes) {
				if (name === 'tempor') {
					const bpm = allegroNumber(value, 'tempo');
					if (bpm <= 0 || bpm > 60_000_000) throw new RangeError('Invalid Allegro tempo.');
					declarations.push({ frame: currentFrame, bpm, order: declarationOrder++, ...(currentBeat === null ? {} : { beat: currentBeat }) });
					if (!knownTempos.length) timingDirty = true;
				} else if (name === 'beatr') {
					const beat = allegroNumber(value, 'beat anchor');
					beatAnchors.push({ frame: currentFrame, beat, order: declarationOrder++ });
					if (!knownTempos.length) timingDirty = true;
				} else if (name === 'timesig_numr' || name === 'timesig_denr') {
					const frame = currentFrame;
					const parts = signatureParts.get(frame) ?? {};
					if (name === 'timesig_numr') parts.numerator = allegroNumber(value, 'signature numerator');
					else parts.denominator = allegroNumber(value, 'signature denominator');
					signatureParts.set(frame, parts);
				} else if (name === 'seqnames' || name === 'tracknames') track.name = allegroString(value);
				else if (name === 'keysigi' || name === 'modea') {
					const mapKey = `${trackIndex}:${currentFrame}`;
					const signature = keySignatures.get(mapKey) ?? { frame: currentFrame, track, key: 0, minor: false };
					if (name === 'keysigi') signature.key = midiFileInteger(allegroNumber(value, 'key signature'), -7, 7, 'key signature');
					else { const mode = allegroString(value); if (mode !== 'major' && mode !== 'minor') throw new RangeError('Unsupported Allegro key mode.'); signature.minor = mode === 'minor'; }
					keySignatures.set(mapKey, signature);
				} else track.events.push(allegroAttributeToEvent(name, value, currentFrame, channel, key));
			}
			if (isNote) {
				if (duration <= 0) throw new RangeError('Allegro note duration must be positive.');
				midiFileInteger(pitch, 0, 127, 'Allegro pitch (microtonal notes are unsupported)');
				midiFileInteger(channel, 0, 15, 'Allegro channel');
				midiFileInteger(Math.round(velocity), 0, 127, 'Allegro velocity');
				track.notes.push({ id: `allegro-${trackIndex}-${noteCount++}`, pitch, channel, velocity: Math.round(velocity),
					startFrame: currentFrame, durationFrames: duration });
			}
			if (next !== null) currentFrame += next;
			else if (isNote) currentFrame += duration;
			if (next !== null || isNote) currentBeat = null;
		} catch (error) {
			throw new RangeError(`Allegro line ${lineIndex + 1}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	}
	if (!tracks.size) throw new RangeError('Allegro file contains no tracks or events.');
	for (const signature of keySignatures.values()) signature.track.events.push({ frame: signature.frame, status: 255, metaType: 89, data: [signature.key & 255, signature.minor ? 1 : 0] });
	const tempoDeclarations = allegroTempoDeclarations(declarations, beatAnchors, sampleRate);
	if (!materialize) return { document: null, tempoDeclarations };
	if (!sameAllegroTempoClock(knownTempos, tempoDeclarations)) throw new RangeError('Allegro tempo expressions cannot be resolved to one stable clock. Use explicit second or beat positions.');
	const tempos = tempoDeclarations.length ? [...tempoDeclarations] : [{ frame: 0, bpm: 100 }];
	if (!tempos.some(tempo => tempo.frame === 0)) tempos.unshift({ frame: 0, bpm: 100 });
	const signatures: MidiFileSignature[] = [];
	for (const [frame, parts] of signatureParts) {
		if (!parts.numerator || !parts.denominator) throw new RangeError('Allegro time signature requires numerator and denominator.');
		signatures.push({ frame, numerator: parts.numerator, denominator: parts.denominator });
	}
	if (!signatures.some(signature => signature.frame === 0)) signatures.unshift({ frame: 0, numerator: 4, denominator: 4 });
	const document: MidiFileDocument = {
		sampleRate, tempos: offsetAllegroTiming(tempos, offset), signatures: offsetAllegroTiming(signatures, offset),
		tracks: [...tracks.entries()].sort(([a], [b]) => a - b).map(([, track]) => ({
			name: track.name,
			notes: offsetAllegroNotes(track.notes, offset),
			...(track.events.length ? { events: track.events.map(event => ({ ...event, frame: offsetAllegroFrame(event.frame, offset, 'Allegro event time') })) } : {}),
		})),
	};
	validateMidiFileDocument(document);
	return { document, tempoDeclarations };
}

export function writeAllegroFile(document: MidiFileDocument): string {
	validateMidiFileDocument(document);
	if (document.tracks.some(track => track.notes.some(note => note.onsetStop))) throw new RangeError('Allegro cannot preserve a note stopped by a same-frame panic. Export MIDI or save the native project.');
	if (document.tracks.some(track => track.notes.some(note => note.midiPort !== undefined))) throw new RangeError('Allegro cannot preserve authored MIDI port destinations. Export MIDI or save the native project.');
	if (document.signatures.some(signature => (signature.clocksPerMetronomeClick ?? 24) !== 24 || (signature.notated32ndNotesPerQuarter ?? 8) !== 8)) {
		throw new RangeError('MIDI metronome and notation clocks cannot be represented in Allegro.');
	}
	const lines = ['#offset 0'];
	const seconds = (frame: number): string => String(Number((frame / document.sampleRate).toFixed(10)));
	for (const [index, track] of document.tracks.entries()) {
		if (/[\r\n]/u.test(track.name)) throw new RangeError('A multiline track name cannot be represented in Allegro. Export MIDI instead.');
		lines.push(`#track ${index} ${track.name}`);
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
