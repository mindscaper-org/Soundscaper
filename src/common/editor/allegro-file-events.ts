/* SPDX-License-Identifier: AGPL-3.0-only */

import { allegroNumber, allegroQuotedString, allegroString } from './allegro-file-fields.ts';
import { midiFileInteger, type MidiFileEvent } from './midi-file-types.ts';
import { decodeMidiFileText } from './midi-file-text.ts';

const TEXT_ATTRIBUTES: Readonly<Record<string, number>> = { texts: 1, copyrights: 2, names: 3, instruments: 4, lyrics: 5, markers: 6, cues: 7, miscs: 8 };
const encoder = new TextEncoder();

function channelByte(channel: number): number { return midiFileInteger(channel, 0, 15, 'Allegro channel'); }
function normalizedByte(value: string): number {
	const number = allegroNumber(value, 'controller value');
	if (number < 0 || number > 1) throw new RangeError('Allegro controller values must be between 0 and 1.');
	return Math.round(number * 127);
}

export function assertAllegroGlobalTextChannel(channel: number): void {
	if (channel !== -1) throw new RangeError('Channel-scoped Allegro text cannot retain its MIDI association. Import MIDI instead.');
}

export function allegroAttributeToEvent(name: string, value: string, frame: number, channel: number, key: number | null): MidiFileEvent {
	const controller = /^control(\d+)r$/.exec(name);
	if (controller) return { frame, status: 176 | channelByte(channel), data: [midiFileInteger(Number(controller[1]), 0, 127, 'controller'), normalizedByte(value)] };
	if (name === 'programi') return { frame, status: 192 | channelByte(channel), data: [midiFileInteger(allegroNumber(value, 'program'), 0, 127, 'program')] };
	if (name === 'pressurer') return key === null
		? { frame, status: 208 | channelByte(channel), data: [normalizedByte(value)] }
		: { frame, status: 160 | channelByte(channel), data: [midiFileInteger(key, 0, 127, 'pressure key'), normalizedByte(value)] };
	if (name === 'bendr') {
		const bend = allegroNumber(value, 'pitch bend');
		if (bend < -1 || bend > 1) throw new RangeError('Allegro pitch bend must be between -1 and 1.');
		const position = Math.min(16_383, Math.round((bend + 1) * 8192));
		return { frame, status: 224 | channelByte(channel), data: [position & 127, position >> 7] };
	}
	if (TEXT_ATTRIBUTES[name] !== undefined) {
		assertAllegroGlobalTextChannel(channel);
		return { frame, status: 255, metaType: TEXT_ATTRIBUTES[name], data: [...encoder.encode(allegroString(value))] };
	}
	if (name === 'sysexs' || name === 'sqspecifics') {
		const hex = allegroString(value);
		if (!/^(?:[\da-f]{2})*$/i.test(hex)) throw new RangeError('Invalid Allegro hexadecimal message.');
		let data = (hex.match(/../g) ?? []).map(byte => parseInt(byte, 16));
		if (name === 'sysexs') {
			if (data[0] === 240) data = data.slice(1);
			return { frame, status: 240, data };
		}
		return { frame, status: 255, metaType: 127, data };
	}
	throw new RangeError(`Unsupported Allegro attribute: ${name}.`);
}

export function allegroEventFields(event: MidiFileEvent): string {
	const type = event.status & 240;
	const channel = event.status & 15;
	if (type === 176) return `V${channel} -control${event.data[0]}r:${event.data[1]! / 127}`;
	if (type === 192) return `V${channel} -programi:${event.data[0]}`;
	if (type === 208) return `V${channel} -pressurer:${event.data[0]! / 127}`;
	if (type === 160) throw new RangeError('Polyphonic pressure cannot be represented in Allegro without creating a note in PortSMF. Export MIDI instead.');
	if (type === 224) return `V${channel} -bendr:${(event.data[0]! + event.data[1]! * 128) / 8192 - 1}`;
	if (event.status === 240) return `V- -sysexs:"f0${event.data.map(byte => byte.toString(16).padStart(2, '0')).join('')}"`;
	if (event.status === 255) {
		const name = Object.keys(TEXT_ATTRIBUTES).find(attribute => TEXT_ATTRIBUTES[attribute] === event.metaType);
		if (name) return `V- -${name}:${allegroQuotedString(decodeMidiFileText(Uint8Array.from(event.data)))}`;
		if (event.metaType === 127) return `V- -sqspecifics:"${event.data.map(byte => byte.toString(16).padStart(2, '0')).join('')}"`;
		if (event.metaType === 89) return `V- -keysigi:${event.data[0]! > 127 ? event.data[0]! - 256 : event.data[0]} -modea:'${event.data[1] ? 'minor' : 'major'}'`;
	}
	throw new RangeError(`MIDI event ${event.status.toString(16)} cannot be represented in Allegro.`);
}
