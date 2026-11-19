/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';

export const AUDIO_IMPORT_FORMATS = [
	['MP3', 'mp3', 'libmp3lame', 'audio/mpeg'], ['MP2', 'mp2', 'mp2', 'audio/mpeg'],
	['FLAC', 'flac', 'flac', 'audio/flac'], ['Ogg Vorbis', 'ogg', 'libvorbis', 'audio/ogg'],
	['Opus', 'opus', 'libopus', 'audio/ogg'], ['WavPack', 'wv', 'wavpack', 'audio/wavpack'],
	['AIFF', 'aiff', 'pcm_s16be', 'audio/aiff'], ['AAC', 'aac', 'aac', 'audio/aac'], ['M4A', 'm4a', 'aac', 'audio/mp4'],
	['Ogg Vorbis (.oga alias)', 'oga', 'libvorbis', ''], ['WavPack (.wavpack alias)', 'wavpack', 'wavpack', ''],
	['AIFF (.aif alias)', 'aif', 'pcm_s16be', ''], ['AIFF-C little-endian PCM', 'aifc', 'pcm_s16le', ''],
] as const;

interface EncodingCore {
	setLogger(callback: (entry: { message: string }) => void): void;
	exec(...arguments_: string[]): number;
	reset(): void;
	readonly FS: { writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
}

let core: Promise<EncodingCore> | undefined;

/** Real independent FFmpeg files, with the same reviewed Opus/WavPack encoders as the browser inputs. */
export async function encodedAudioImportFixture(extension: string, codec: string, mimeType: string) {
	const channels = sourceChannels(48_000);
	if (extension === 'opus' || extension === 'wv' || extension === 'wavpack') {
		const format = extension === 'opus' ? 'opus' : 'wavpack';
		const pcm = Float32Array.from({ length: 96_000 }, (_, index) => channels[index % 2]![Math.floor(index / 2)]!);
		const bytes = await encodeDedicatedAudioPcm({ format, input: new Uint8Array(pcm.buffer),
			frameCount: 48_000, channelCount: 2, sampleRate: 48_000,
			settings: format === 'opus' ? { bitrateKbps: 128, vbrMode: 1 } : { compressionLevel: 2 }, maximumOutputBytes: 1024 * 1024,
		}, { loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
		return { name: `import-tone.${extension}`, mimeType, buffer: Buffer.from(bytes), expectedPcm: channels };
	}
	const encoder = await (core ??= encodingCore());
	const name = `import-tone.${extension}`, logs: string[] = [];
	encoder.setLogger(({ message }) => { logs.push(message); });
	const wave = pcm16Wave(channels);
	try {
		encoder.FS.writeFile('input.wav', wave);
		assert.equal(encoder.exec('-hide_banner', '-nostdin', '-y', '-i', 'input.wav', '-c:a', codec, name), 0, logs.join('\n'));
		return { name, mimeType, buffer: Buffer.from(encoder.FS.readFile(name)), expectedPcm: channels.map(channel =>
			Float32Array.from(channel, value => (Math.round(value * 32767) || 0) / 32768)) };
	} finally {
		encoder.reset();
		for (const path of ['input.wav', name]) { try { encoder.FS.unlink(path); } catch {} }
	}
}

export function waveAliasImportFixture() {
	const channels = sourceChannels(48_000);
	return { name: 'field-recording.wave', mimeType: '', buffer: Buffer.from(pcm16Wave(channels)),
		expectedPcm: quantized(channels) };
}

/** Independently authored ds64 geometry, including the BW64 zero sample-count form. */
export function extendedWaveImportFixture(signature: 'RF64' | 'BW64') {
	const frames = 4800, channels = sourceChannels(frames);
	const buffer = Buffer.alloc(12 + 36 + 24 + 8 + frames * 4);
	buffer.write(signature); buffer.writeUInt32LE(0xffff_ffff, 4); buffer.write('WAVEds64', 8);
	buffer.writeUInt32LE(28, 16); buffer.writeBigUInt64LE(BigInt(buffer.length - 8), 20);
	buffer.writeBigUInt64LE(BigInt(frames * 4), 28); buffer.writeBigUInt64LE(signature === 'RF64' ? BigInt(frames) : 0n, 36);
	buffer.write('fmt ', 48); buffer.writeUInt32LE(16, 52); buffer.writeUInt16LE(1, 56); buffer.writeUInt16LE(2, 58);
	buffer.writeUInt32LE(48_000, 60); buffer.writeUInt32LE(192_000, 64); buffer.writeUInt16LE(4, 68); buffer.writeUInt16LE(16, 70);
	buffer.write('data', 72); buffer.writeUInt32LE(0xffff_ffff, 76);
	for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) {
		buffer.writeInt16LE(Math.round(channels[channel]![frame]! * 32767), 80 + (frame * 2 + channel) * 2);
	}
	return { name: signature === 'RF64' ? 'field-recording.rf64' : 'spatial-master.bw64', mimeType: '', buffer, expectedPcm: quantized(channels) };
}

function sourceChannels(frameCount: number): Float32Array[] {
	return Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: frameCount }, (_, frame) =>
		Math.sin(2 * Math.PI * 330 * frame / 48_000 + (channel ? Math.PI / 3 : 0)) * (channel ? .1 : .3)));
}

function quantized(channels: readonly Float32Array[]): Float32Array[] {
	return channels.map(channel => Float32Array.from(channel, value => (Math.round(value * 32767) || 0) / 32768));
}

async function encodingCore(): Promise<EncodingCore> {
	const url = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
	const scope = globalThis as unknown as { self?: unknown; location?: unknown };
	scope.self ??= globalThis; scope.location ??= url;
	const [{ default: createCore }, wasmBinary] = await Promise.all([
		import(url.href), readFile(new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)),
	]);
	return await createCore({ wasmBinary }) as EncodingCore;
}

function pcm16Wave(channels: readonly Float32Array[]): Uint8Array {
	const buffer = Buffer.alloc(44 + 48_000 * 4);
	buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
	buffer.writeUInt32LE(48_000, 24); buffer.writeUInt32LE(192_000, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
	for (let frame = 0; frame < 48_000; frame++) for (let channel = 0; channel < 2; channel++) {
		buffer.writeInt16LE(Math.round(channels[channel]![frame]! * 32767), 44 + (frame * 2 + channel) * 2);
	}
	return buffer;
}
