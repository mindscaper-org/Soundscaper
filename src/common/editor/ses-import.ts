/* SPDX-License-Identifier: AGPL-3.0-only */

import { SES_BINARY_MAXIMUM_BYTES } from './ses-format.ts';
import type { SesxAudioReference, SesxClip, SesxDocument, SesxTrack } from './sesx-import.ts';

/** The decoded subset of the legacy COOLNESS session, with explicit losses. */
export interface SesImportWarning {
	readonly code: string;
	readonly message: string;
	readonly disposition?: 'converted' | 'omitted';
}
export interface SesImportResult {
	readonly document: SesxDocument;
	readonly warnings: readonly SesImportWarning[];
}

interface Chunk { readonly id: string; readonly body: Uint8Array }
interface Table { readonly body: Uint8Array; readonly count: number; readonly stride: number }

const MAXIMUM_TRACKS = 1024;
const MAXIMUM_CLIPS = 100_000;
const MAXIMUM_FILES = 100_000;
const KNOWN_METADATA = new Set(['vers', 'stat', 'blk2']);
const FEATURE_CHUNKS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
	tkfx: ['effects', 'Legacy track effects are not imported; tracks play dry.'],
	bkfx: ['effects', 'Legacy clip effects are not imported; clips play dry.'],
	tkeq: ['effects', 'Legacy track equalization is not imported.'],
	envp: ['automation', 'Legacy volume and pan envelopes are not imported; static gains are used.'],
	ep20: ['automation', 'Legacy clip automation is not imported; static gains are used.'],
	env2: ['automation', 'Legacy automation is not imported; static controls are used.'],
	loop: ['loops', 'Legacy clip repeats are not imported; each clip plays its stored source span once.'],
	cues: ['markers', 'Legacy cue and region markers are not imported.'],
	buss: ['routing', 'Legacy buses, sends and bus processing are not imported.'],
	BUSS: ['routing', 'Legacy buses, sends and bus processing are not imported.'],
	MCHN: ['routing', 'Legacy multichannel routing is not imported; the project uses stereo output.'],
	MChn: ['routing', 'Legacy multichannel routing is not imported; the project uses stereo output.'],
	vids: ['video', 'Legacy video references are not imported.'],
	tmpo: ['tempo', 'Legacy tempo, meter and ruler settings are not imported.'],
	bk20: ['clip-settings', 'Additional legacy clip settings, including repeat extents, are not imported.'],
});

/**
 * Read count-prefixed Cool Edit session tables, never scanning arbitrary bytes
 * for record signatures. Field layouts are documented independently by
 * Audio::CoolEdit's Settings.pm and ses2als's SessionFile.cpp, with the larger
 * track stride recorded by ses2sesx.py. See docs/legacy-ses-import.md.
 */
export function parseSesDocument(
	data: Uint8Array,
	options: Readonly<{ maximumBytes?: number }> = {},
): SesImportResult {
	if (!(data instanceof Uint8Array)) throw new TypeError('An SES session must be binary bytes.');
	const maximumBytes = options.maximumBytes ?? SES_BINARY_MAXIMUM_BYTES;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 12) throw new RangeError('The SES byte limit must be a finite integer of at least 12.');
	if (data.length > maximumBytes) throw new RangeError('The SES session exceeds its binary byte limit.');
	if (data.length < 12 || latin1(data.subarray(0, 8)) !== 'COOLNESS') throw new SyntaxError('A legacy SES session must start with COOLNESS.');
	if (u32(data, 8) !== data.length - 12) throw new SyntaxError('The SES declared size does not match the session bytes.');
	const chunks = walkChunks(data.subarray(12));
	const indexed = new Map<string, Uint8Array>();
	for (const chunk of chunks) {
		if (indexed.has(chunk.id)) throw new SyntaxError(`Duplicate SES chunk: ${chunk.id}.`);
		indexed.set(chunk.id, chunk.body);
	}
	const header = requiredChunk(indexed, 'hdr ');
	if (header.length < 32) throw new SyntaxError('The SES session header is truncated or uses an unsupported layout.');
	const sampleRate = u32(header, 0);
	if (sampleRate < 1 || sampleRate > 768_000) throw new RangeError('The SES sample rate is invalid.');
	const warnings: SesImportWarning[] = [{ code: 'ses.partial-import', message:
		'Legacy SES import preserves supported audio tracks, clip timing, trims, static gains and mute/solo states. Effects, envelopes, pan, fades, loops, routing and other legacy settings may be omitted; verify the mix against the original session.' }];
	const warn = (code: string, message: string): void => {
		if (!warnings.some(warning => warning.code === code)) warnings.push({ code, message,
			...(code.endsWith('-converted') ? { disposition: 'converted' as const } : {}) });
	};
	const files = readFiles(indexed);
	const trackTable = readTable(requiredChunk(indexed, 'trks'), [72, 96, 152], MAXIMUM_TRACKS, 'track');
	const clips = readClips(requiredChunk(indexed, 'blk '), trackTable.count, files, warn);
	assertUnambiguousClipOrder(clips);
	const tracks: SesxTrack[] = [];
	for (let index = 0; index < trackTable.count; index += 1) {
		const offset = 4 + index * trackTable.stride;
		const body = trackTable.body;
		const flags = u32(body, offset + 16);
		tracks.push(Object.freeze({
			id: String(index + 1), name: terminatedString(body.subarray(offset + 20, offset + 56), false) || `Track ${String(index + 1)}`,
			channelCount: 2, gain: stereoGain(body, offset, warn), pan: 0,
			mute: Boolean(flags & 1), solo: Boolean(flags & 2), clips: Object.freeze(clips[index]!),
		}));
		if ((flags & ~7) !== 0) warn('ses.track-settings-omitted', 'Some legacy track flags are not imported.');
	}
	const unknown: string[] = [];
	for (const { id, body } of chunks) {
		if (['hdr ', 'trks', 'blk ', 'LISTFILE', 'WLST'].includes(id) || KNOWN_METADATA.has(id)) continue;
		const feature = FEATURE_CHUNKS[id];
		if (feature && body.length) warn(`ses.${feature[0]}-omitted`, feature[1]);
		else if (!feature) unknown.push(id);
	}
	if (unknown.length) warn('ses.unknown-chunks', `Unrecognized legacy session data is not imported (${unknown.slice(0, 20).join(', ')}).`);
	const versionBytes = indexed.get('vers');
	return Object.freeze({
		document: Object.freeze({
			version: versionBytes ? terminatedString(versionBytes, false, 4096) : null,
			applicationVersion: null, sampleRate, channelCount: 2,
			tracks: Object.freeze(tracks), master: Object.freeze({ gain: stereoGain(header, 16, warn), pan: 0, mute: false }),
			files, omissions: Object.freeze({ effects: 0, automation: 0, routing: 0, video: 0, markers: 0, clipGroups: 0 }),
		}),
		warnings: Object.freeze(warnings.map(warning => Object.freeze(warning))),
	});
}

function walkChunks(data: Uint8Array): readonly Chunk[] {
	const result: Chunk[] = [];
	let offset = 0;
	while (offset < data.length) {
		if (result.length >= MAXIMUM_FILES || offset + 8 > data.length) throw new SyntaxError('The SES chunk table is truncated or exceeds its count limit.');
		let id = latin1(data.subarray(offset, offset + 4));
		if (!/^[\x20-\x7e]{4}$/u.test(id)) throw new SyntaxError('An SES chunk identifier is invalid.');
		const headerBytes = id === 'LIST' && latin1(data.subarray(offset + 4, offset + 8)) === 'FILE' ? 12 : 8;
		if (headerBytes === 12) id = 'LISTFILE';
		if (offset + headerBytes > data.length) throw new SyntaxError('An SES chunk header is truncated.');
		const length = u32(data, offset + headerBytes - 4);
		const end = offset + headerBytes + length;
		if (end > data.length) throw new SyntaxError(`The SES ${id} chunk exceeds its container bounds.`);
		result.push({ id, body: data.subarray(offset + headerBytes, end) });
		offset = end;
	}
	return result;
}

function readTable(body: Uint8Array, sizes: readonly number[], maximum: number, name: string): Table {
	if (body.length < 4) throw new SyntaxError(`The SES ${name} record count is truncated.`);
	const count = u32(body, 0);
	if (count > maximum) throw new RangeError(`The SES ${name} record count exceeds its limit.`);
	if (!count) {
		if (body.length !== 4) throw new SyntaxError(`An empty SES ${name} table contains unexpected records.`);
		return { body, count, stride: sizes[0]! };
	}
	const stride = (body.length - 4) / count;
	if (!sizes.includes(stride)) throw new SyntaxError(`Unsupported SES ${name} record layout (${String(stride)} bytes).`);
	return { body, count, stride };
}

function readFiles(chunks: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, SesxAudioReference> {
	const result = new Map<string, SesxAudioReference>();
	for (const containerId of ['LISTFILE', 'WLST']) {
		const container = chunks.get(containerId);
		if (!container) continue;
		for (const { id, body } of walkChunks(container)) {
			if (id !== 'wav ') throw new SyntaxError(`Unsupported SES media record: ${id}.`);
			if (result.size >= MAXIMUM_FILES) throw new RangeError('The SES media record count exceeds its limit.');
			if (body.length < 9) throw new SyntaxError('The SES media record is truncated.');
			const fileId = String(u32(body, 0));
			if (result.has(fileId)) throw new SyntaxError(`Duplicate SES media reference: ${fileId}.`);
			const path = terminatedString(body.subarray(8), true, 4096);
			if (!path || Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
				throw new SyntaxError('The SES media path is invalid.');
			}
			const absolute = /^(?:[a-z]:[\\/]|[\\/]{2}|\/)/iu.test(path);
			const name = path.split(/[\\/]/u).filter(Boolean).at(-1);
			if (!name) throw new SyntaxError('The SES media path has no filename.');
			result.set(fileId, Object.freeze({ id: fileId, name, relativePath: absolute ? null : path, absolutePath: absolute ? path : null }));
		}
	}
	return result;
}

function readClips(
	body: Uint8Array,
	trackCount: number,
	files: ReadonlyMap<string, SesxAudioReference>,
	warn: (code: string, message: string) => void,
): SesxClip[][] {
	const table = readTable(body, [72, 84, 88], MAXIMUM_CLIPS, 'clip');
	const tracks: SesxClip[][] = Array.from({ length: trackCount }, () => []);
	const handles = new Set<number>();
	for (let index = 0; index < table.count; index += 1) {
		const offset = 4 + index * table.stride;
		const handle = u32(body, offset + 40);
		if (handles.has(handle)) throw new SyntaxError(`Duplicate SES clip handle: ${String(handle)}.`);
		handles.add(handle);
		const fileId = String(u32(body, offset + 48));
		const file = files.get(fileId);
		if (!file) throw new SyntaxError(`An SES clip has an unresolved media reference: ${fileId}.`);
		const track = i32(body, offset + 52);
		if (track < 1 || track > trackCount) throw new SyntaxError('An SES clip refers to an unavailable track.');
		const start = u32(body, offset + 32);
		const length = u32(body, offset + 36);
		const sourceIn = u32(body, offset + 64);
		if (length < 1) throw new RangeError('The SES clip length is invalid.');
		const flags = u32(body, offset + 44);
		if (flags & 1) warn('ses.clip-groups-omitted', 'Legacy clip group relationships are not imported.');
		if (flags & ~7) warn('ses.clip-settings-omitted', 'Some legacy clip flags, including recording and punch settings, are not imported.');
		tracks[track - 1]!.push(Object.freeze({
			zOrder: index, id: String(handle), fileId, name: file.name,
			startFrame: start, endFrame: start + length, sourceInFrame: sourceIn, sourceOutFrame: sourceIn + length,
			fadeInFrames: 0, fadeOutFrames: 0, fadeCurvesChanged: false,
			gain: stereoGain(body, offset, warn), muted: Boolean(flags & 4), offline: false,
			looped: false, linkedCrossfade: false, crossfadePartnerIds: Object.freeze([]), unsupportedPan: false,
			remappedChannels: false, mappedChannelCount: null, stretch: false,
		}));
	}
	return tracks;
}

/** Binary legacy sessions do not establish SESX's stacking semantics. */
function assertUnambiguousClipOrder(tracks: readonly (readonly SesxClip[])[]): void {
	for (const clips of tracks) {
		const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame);
		let endFrame = 0;
		for (const clip of ordered) {
			if (clip.startFrame < endFrame) throw new SyntaxError('Overlapping legacy clips on one track are unsupported; separate or render them in the original application.');
			endFrame = clip.endFrame;
		}
	}
}

function stereoGain(body: Uint8Array, offset: number, warn: (code: string, message: string) => void): number {
	const left = view(body).getFloat64(offset, true);
	const right = view(body).getFloat64(offset + 8, true);
	if (!Number.isFinite(left) || left < 0 || !Number.isFinite(right) || right < 0) throw new RangeError('The SES gain must be finite and non-negative.');
	if (left !== right) warn('ses.channel-gain-converted', 'Unequal legacy left/right gains are converted to their larger static gain with centered pan. Verify the stereo balance.');
	return Math.max(left, right);
}

function requiredChunk(chunks: ReadonlyMap<string, Uint8Array>, id: string): Uint8Array {
	const body = chunks.get(id);
	if (!body) throw new SyntaxError(`The SES session has no ${id} chunk; its layout is unsupported.`);
	return body;
}

function terminatedString(bytes: Uint8Array, required: boolean, maximumBytes = 4096): string {
	const end = bytes.indexOf(0);
	if (required && end < 0) throw new SyntaxError('The SES media path has no terminator.');
	if ((end < 0 ? bytes.length : end) > maximumBytes) throw new RangeError('The SES text or media path exceeds its length limit.');
	return latin1(end < 0 ? bytes : bytes.subarray(0, end));
}

function latin1(bytes: Uint8Array): string {
	let result = '';
	for (const byte of bytes) result += String.fromCharCode(byte);
	return result;
}

function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function u32(bytes: Uint8Array, offset: number): number { return view(bytes).getUint32(offset, true); }
function i32(bytes: Uint8Array, offset: number): number { return view(bytes).getInt32(offset, true); }
