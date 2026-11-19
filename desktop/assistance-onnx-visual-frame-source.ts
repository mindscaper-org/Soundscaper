/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, VFR-preserving access to authenticated assistance RGBA frame packs. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ASSISTANCE_BINARY_MAXIMUM_BYTES } from '../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceFramePackOrdinalRangeIndex } from '../src/common/editor/assistance/frame-pack-ordinal-range-index.ts';

import {
	reviewAssistanceVisualFramePack,
	type AssistanceVisualFramePackFrame,
	type ReviewedAssistanceVisualFramePack,
} from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { reviewAssistanceVisualFramePackMembers } from
	'../src/common/editor/assistance/visual-frame-pack-set-v1.ts';
import type {
	AssistanceRuntimeFamilyInputGrantV1,
} from './assistance-runtime-family-job-contract.ts';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';

const FRAME_PACK_MEDIA_TYPE = 'application/vnd.soundscaper.frame-pack';
const MAXIMUM_VISUAL_FRAMES = 100_000;
const MAXIMUM_READ_BYTES = 1024 * 1024;

interface PackIndexV1 {
	readonly input: AssistanceRuntimeFamilyInputGrantV1;
	readonly byteOffset: number;
	readonly byteLength: number;
	readonly sha256: string;
	readonly ordinalStart: number;
	readonly frameCount: number;
}

export interface AssistanceOnnxVisualFrameAuthorityV1 {
	/** Full source geometry used by semantic results and crop authority. */
	readonly width: number;
	readonly height: number;
	/** Bounded RGBA geometry used only for tensor preprocessing. */
	readonly rasterWidth: number;
	readonly rasterHeight: number;
	readonly timescale: number;
	readonly frameCount: number;
	readonly frames: readonly Readonly<{
		readonly sourceFrame: number;
		readonly presentationTick: string;
	}>[];
	readFrame(ordinal: number): Promise<AssistanceVisualFramePackFrame>;
	release(): void;
}

export async function openAssistanceOnnxVisualFrameSourceV1(
	inputs: readonly AssistanceRuntimeFamilyInputGrantV1[],
	signal?: AbortSignal,
): Promise<AssistanceOnnxVisualFrameAuthorityV1> {
	if (inputs.length < 1 || inputs.some(({ role, mediaType }) =>
		role !== 'frame-pack' || mediaType !== FRAME_PACK_MEDIA_TYPE)) {
		throw new TypeError('Visual ONNX execution requires exact assistance frame-pack inputs.');
	}
	let width: number | null = null;
	let height: number | null = null;
	let rasterWidth: number | null = null;
	let rasterHeight: number | null = null;
	let timescale: number | null = null;
	let priorSource = -1;
	let priorTick = -1n;
	const frames: Array<Readonly<{ sourceFrame: number; presentationTick: string }>> = [];
	const packs: PackIndexV1[] = [];
	let cached: Readonly<{ range: PackIndexV1; pack: ReviewedAssistanceVisualFramePack }> | null = null;
	for (const input of inputs) {
		signal?.throwIfAborted();
		const bytes = await readAuthenticatedPackBytes(input, 0, input.byteLength, input.sha256, signal);
		const members = reviewAssistanceVisualFramePackMembers(bytes);
		for (const { pack: reviewed, byteOffset, byteLength } of members) {
			if (reviewed.frameCount < 1) throw new RangeError('A visual frame pack cannot be empty.');
			if (width !== null && (reviewed.sourceWidth !== width || reviewed.sourceHeight !== height
				|| reviewed.rasterWidth !== rasterWidth || reviewed.rasterHeight !== rasterHeight
				|| reviewed.timescale !== timescale)) {
				throw new RangeError('Visual frame-pack chunks disagree about geometry or timescale.');
			}
			width ??= reviewed.sourceWidth;
			height ??= reviewed.sourceHeight;
			rasterWidth ??= reviewed.rasterWidth;
			rasterHeight ??= reviewed.rasterHeight;
			timescale ??= reviewed.timescale;
			for (let index = 0; index < reviewed.frameCount; index += 1) {
				const frame = reviewed.frameTiming(index);
				if (frame.sourceFrame <= priorSource || BigInt(frame.presentationTick) <= priorTick) {
					throw new RangeError('Visual frame packs must retain ordered VFR source/tick authority.');
				}
				priorSource = frame.sourceFrame;
				priorTick = BigInt(frame.presentationTick);
				frames.push(frame);
				if (frames.length > MAXIMUM_VISUAL_FRAMES) {
					throw new RangeError('Visual ONNX execution exceeds its exact frame bound.');
				}
			}
			const sha256 = byteLength === bytes.length ? input.sha256
				: createHash('sha256').update(bytes.subarray(byteOffset, byteOffset + byteLength)).digest('hex');
			const range = Object.freeze({ input, byteOffset, byteLength, sha256,
				ordinalStart: frames.length - reviewed.frameCount,
				frameCount: reviewed.frameCount });
			packs.push(range);
			if (inputs.length === 1 && members.length === 1) cached = { range, pack: reviewed };
		}
	}
	if (width === null || height === null || rasterWidth === null || rasterHeight === null
		|| timescale === null) {
		throw new RangeError('Visual ONNX execution requires at least one reviewed frame.');
	}
	const locatePack = createAssistanceFramePackOrdinalRangeIndex(packs);
	let released = false;
	return Object.freeze({ width, height, rasterWidth, rasterHeight,
		timescale, frameCount: frames.length,
		frames: Object.freeze(frames),
		async readFrame(ordinalValue: number) {
			if (released) throw new Error('The visual frame source has been released.');
			signal?.throwIfAborted();
			if (!Number.isSafeInteger(ordinalValue) || ordinalValue < 0 || ordinalValue >= frames.length) {
				throw new RangeError('A visual adapter requested a frame outside reviewed custody.');
			}
			const range = locatePack(ordinalValue);
			if (cached?.range !== range) {
				cached = null;
				const bytes = await readAuthenticatedPackBytes(range.input, range.byteOffset,
					range.byteLength, range.sha256, signal);
				if (released) throw new Error('The visual frame source has been released.');
				cached = { range, pack: reviewAssistanceVisualFramePack(bytes) };
			}
			return cached.pack.frame(ordinalValue - range.ordinalStart);
		},
		release() {
			released = true;
			cached = null;
		},
	});
}

async function readAuthenticatedPackBytes(
	input: AssistanceRuntimeFamilyInputGrantV1,
	byteOffset: number,
	byteLength: number,
	expectedSha256: string,
	signal?: AbortSignal,
): Promise<Buffer> {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > ASSISTANCE_BINARY_MAXIMUM_BYTES) {
		throw new RangeError('A visual frame pack exceeds its exact byte bound.');
	}
	signal?.throwIfAborted();
	const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
	const handle = await open(input.path, constants.O_RDONLY | noFollow);
	try {
		const stats = await handle.stat({ bigint: true });
		const identity = nativeChildFileIdentityFromStat(stats);
		if (!stats.isFile() || stats.size !== BigInt(input.byteLength)
			|| identity.dev !== input.identity.dev || identity.ino !== input.identity.ino) {
			throw new Error('A visual frame pack file identity or size changed.');
		}
		const hash = createHash('sha256');
		const bytes = Buffer.allocUnsafe(byteLength);
		let offset = 0;
		while (offset < byteLength) {
			signal?.throwIfAborted();
			const { bytesRead } = await handle.read(bytes, offset,
				Math.min(MAXIMUM_READ_BYTES, byteLength - offset), byteOffset + offset);
			if (bytesRead === 0) throw new Error('A visual frame pack ended during authenticated read.');
			hash.update(bytes.subarray(offset, offset + bytesRead));
			offset += bytesRead;
		}
		signal?.throwIfAborted();
		if (hash.digest('hex') !== expectedSha256) {
			throw new Error('A visual frame pack digest changed.');
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

export function assistanceOnnxVisualAuthorityJsonV1(
	source: AssistanceOnnxVisualFrameAuthorityV1,
): Readonly<{ width: number; height: number; timescale: number;
	frames: AssistanceOnnxVisualFrameAuthorityV1['frames'] }> {
	return Object.freeze({ width: source.width, height: source.height,
		timescale: source.timescale, frames: source.frames });
}
