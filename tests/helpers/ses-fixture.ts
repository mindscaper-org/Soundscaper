/* SPDX-License-Identifier: AGPL-3.0-only */

/** Synthetic core COOLNESS layout; no upstream session data or audio is copied. */
export interface SesFixtureOptions {
	readonly sampleRate?: number;
	readonly tracks?: readonly { readonly name?: string; readonly gain?: number; readonly rightGain?: number; readonly mute?: boolean; readonly solo?: boolean }[];
	readonly files?: readonly { readonly id?: number; readonly path?: string }[];
	readonly clips?: readonly {
		readonly handle?: number; readonly fileId?: number; readonly track?: number;
		readonly startFrame?: number; readonly lengthFrames?: number; readonly sourceInFrame?: number;
		readonly gain?: number; readonly rightGain?: number; readonly mute?: boolean;
	}[];
	readonly extraChunks?: readonly { readonly id: string; readonly body: Uint8Array }[];
	readonly fileContainer?: 'LISTFILE' | 'WLST';
	readonly clipRecordBytes?: 72 | 84 | 88;
	readonly trackRecordBytes?: 72 | 96 | 152;
}

export function createSesFixture(options: SesFixtureOptions = {}): Uint8Array {
	const tracks = options.tracks ?? [{ name: 'Voice', gain: 0.5 }];
	const clips = options.clips ?? [{ startFrame: 4800, lengthFrames: 9600, sourceInFrame: 2400 }];
	const files = options.files ?? [{ path: 'C:\\media\\Voice.wav' }];
	const header = new Uint8Array(344);
	new DataView(header.buffer).setUint32(0, options.sampleRate ?? 48_000, true);
	new DataView(header.buffer).setUint16(12, 32, true);
	new DataView(header.buffer).setUint16(14, 1, true);
	new DataView(header.buffer).setFloat64(16, 1, true);
	new DataView(header.buffer).setFloat64(24, 1, true);
	const trackBytes = options.trackRecordBytes ?? 96;
	const trackBody = new Uint8Array(4 + tracks.length * trackBytes);
	new DataView(trackBody.buffer).setUint32(0, tracks.length, true);
	for (const [index, track] of tracks.entries()) {
		const offset = 4 + index * trackBytes;
		const view = new DataView(trackBody.buffer);
		view.setFloat64(offset, track.gain ?? 1, true);
		view.setFloat64(offset + 8, track.rightGain ?? track.gain ?? 1, true);
		view.setUint32(offset + 16, (track.mute ? 1 : 0) | (track.solo ? 2 : 0), true);
		trackBody.set(latin1(track.name ?? `Track ${String(index + 1)}`).subarray(0, 35), offset + 20);
	}
	const clipBytes = options.clipRecordBytes ?? 88;
	const clipBody = new Uint8Array(4 + clips.length * clipBytes);
	const clipView = new DataView(clipBody.buffer);
	clipView.setUint32(0, clips.length, true);
	for (const [index, clip] of clips.entries()) {
		const offset = 4 + index * clipBytes;
		clipView.setFloat64(offset, clip.gain ?? 1, true);
		clipView.setFloat64(offset + 8, clip.rightGain ?? clip.gain ?? 1, true);
		clipView.setInt32(offset + 32, clip.startFrame ?? 0, true);
		clipView.setInt32(offset + 36, clip.lengthFrames ?? 9600, true);
		clipView.setUint32(offset + 40, clip.handle ?? index + 10, true);
		clipView.setUint32(offset + 44, clip.mute ? 4 : 0, true);
		clipView.setUint32(offset + 48, clip.fileId ?? 1000, true);
		clipView.setInt32(offset + 52, clip.track ?? 1, true);
		clipView.setInt32(offset + 64, clip.sourceInFrame ?? 0, true);
	}
	const fileBody = concatenate(files.map((file, index) => {
		const path = latin1(file.path ?? 'Voice.wav');
		const record = new Uint8Array(8 + 8 + path.length + 1 + 8);
		record.set(latin1('wav '));
		new DataView(record.buffer).setUint32(4, record.length - 8, true);
		new DataView(record.buffer).setUint32(8, file.id ?? 1000 + index, true);
		new DataView(record.buffer).setUint32(12, 19, true);
		record.set(path, 16);
		return record;
	}));
	const body = concatenate([
		sesFixtureChunk('hdr ', header), sesFixtureChunk('blk ', clipBody),
		sesFixtureChunk('trks', trackBody),
		...(options.extraChunks ?? []).map(chunk => sesFixtureChunk(chunk.id, chunk.body)),
		sesFixtureChunk(options.fileContainer ?? 'LISTFILE', fileBody),
	]);
	const result = new Uint8Array(12 + body.length);
	result.set(latin1('COOLNESS'));
	new DataView(result.buffer).setUint32(8, body.length, true);
	result.set(body, 12);
	return result;
}

export function sesFixtureChunk(id: string, body: Uint8Array): Uint8Array {
	const result = new Uint8Array(id.length + 4 + body.length);
	result.set(latin1(id));
	new DataView(result.buffer).setUint32(id.length, body.length, true);
	result.set(body, id.length + 4);
	return result;
}

function latin1(value: string): Uint8Array {
	return Uint8Array.from(value, character => character.charCodeAt(0));
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.length; }
	return result;
}
