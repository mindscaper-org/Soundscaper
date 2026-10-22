/* SPDX-License-Identifier: AGPL-3.0-only */

/** Index fixed V2 records without retaining entire RGBA packs in memory. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import type { AssistanceOutputClaim } from './assistance-data-claims.ts';
import { withinMillisecond } from './assistance-keyed-video-contract.ts';

const MAGIC = Buffer.from('soundscaper-assistance-frame-pack-v2\n');
const HEADER_BYTES = MAGIC.length + 28;
interface Pack {
	readonly handle: FileHandle;
	readonly claim: AssistanceOutputClaim;
	readonly header: Buffer;
	readonly frameCount: number;
	readonly rgbaBytes: number;
	readonly headers: readonly Buffer[];
}

export async function openAssistanceKeyedVideoFrames(
	claims: readonly AssistanceOutputClaim[],
	openOutput: (claim: AssistanceOutputClaim) => Promise<Readonly<{ path: string }>>,
	frameRate: Readonly<{ num: number; den: number }>,
	signal: AbortSignal,
) {
	const packs: Pack[] = []; const presentationTicks: string[] = [];
	let width = 0; let height = 0; let timescale = 0; let consumed = false;
	const close = async (): Promise<void> => { await Promise.all(packs.map((pack) => pack.handle.close())); };
	try {
		for (const claim of claims) {
			signal.throwIfAborted();
			const { path } = await openOutput(claim);
			const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
			try {
				const stat = await handle.stat();
				if (!stat.isFile() || stat.nlink !== 1 || stat.size !== claim.byteLength) throw new Error('Keyed frame custody changed.');
				const header = await readExact(handle, HEADER_BYTES, 0, signal);
				if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header.readUInt32LE(MAGIC.length) !== 2) {
					throw new TypeError('Keyed video requires full-raster visual frame pack V2.');
				}
				const base = MAGIC.length;
				const w = header.readUInt32LE(base + 4); const h = header.readUInt32LE(base + 8);
				const scale = header.readUInt32LE(base + 20); const count = header.readUInt32LE(base + 24);
				if (w < 1 || w > 4096 || h < 1 || h > 4096 || header.readUInt32LE(base + 12) !== w
					|| header.readUInt32LE(base + 16) !== h || scale < 1 || scale > 0x7fff_ffff || count < 1
					|| count + presentationTicks.length > 100_000 || (width !== 0 && (w !== width || h !== height || scale !== timescale))) {
					throw new RangeError('Keyed frame packs disagree with full-source geometry or timing.');
				}
				width = w; height = h; timescale = scale;
				const rgbaBytes = w * h * 4; const headers: Buffer[] = [];
				if (HEADER_BYTES + count * (16 + rgbaBytes) !== claim.byteLength) throw new RangeError('Keyed frame-pack byte count changed.');
				for (let index = 0; index < count; index += 1) {
					const frameHeader = await readExact(handle, 16, HEADER_BYTES + index * (16 + rgbaBytes), signal);
					const tick = frameHeader.readBigUInt64LE(4); const ordinal = presentationTicks.length;
					if (frameHeader.readUInt32LE(0) !== ordinal || frameHeader.readUInt32LE(12) !== rgbaBytes
						|| tick > 0x7fff_ffff_ffff_ffffn || (ordinal === 0 && tick !== 0n)
						|| (ordinal > 0 && tick <= BigInt(presentationTicks[ordinal - 1]!))
						|| !withinMillisecond(tick, scale, BigInt(ordinal) * BigInt(frameRate.den), frameRate.num)) {
						throw new RangeError('Keyed frame packs lost complete CFR source ordinals.');
					}
					headers.push(frameHeader); presentationTicks.push(String(tick));
				}
				packs.push({ handle, claim, header, frameCount: count, rgbaBytes, headers });
			} catch (error) { await handle.close(); throw error; }
		}
	} catch (error) { await close(); throw error; }
	const alphaSha256: string[] = [];
	return Object.freeze({ width, height, timescale, frameCount: presentationTicks.length, frameRate,
		presentationTicks: Object.freeze(presentationTicks), alphaSha256,
		async consume(consume: (rgba: Uint8Array) => Promise<void>): Promise<void> {
			if (consumed) throw new Error('Keyed frame input may be consumed exactly once.');
			consumed = true;
			for (const pack of packs) {
				const currentHeader = await readExact(pack.handle, HEADER_BYTES, 0, signal);
				if (!currentHeader.equals(pack.header)) throw new Error('Keyed frame pack header changed after review.');
				const hash = createHash('sha256').update(currentHeader);
				for (let index = 0; index < pack.frameCount; index += 1) {
					const offset = HEADER_BYTES + index * (16 + pack.rgbaBytes);
					const header = await readExact(pack.handle, 16, offset, signal);
					if (!header.equals(pack.headers[index]!)) throw new Error('Keyed frame header changed after review.');
					const rgba = await readExact(pack.handle, pack.rgbaBytes, offset + 16, signal);
					hash.update(header).update(rgba);
					const alpha = Buffer.allocUnsafe(pack.rgbaBytes / 4);
					for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = rgba[pixel * 4 + 3]!;
					alphaSha256.push(createHash('sha256').update(alpha).digest('hex'));
					await consume(rgba);
				}
				if (hash.digest('hex') !== pack.claim.sha256) throw new Error('Keyed frame claim digest changed while encoding.');
				const stat = await pack.handle.stat();
				if (!stat.isFile() || stat.nlink !== 1 || stat.size !== pack.claim.byteLength) throw new Error('Keyed frame custody changed while encoding.');
			}
		}, close,
	});
}

async function readExact(handle: FileHandle, length: number, position: number, signal: AbortSignal): Promise<Buffer> {
	const bytes = Buffer.allocUnsafe(length); let offset = 0;
	while (offset < length) {
		signal.throwIfAborted();
		const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
		if (bytesRead === 0) throw new Error('Keyed frame pack was truncated.');
		offset += bytesRead;
	}
	return bytes;
}
