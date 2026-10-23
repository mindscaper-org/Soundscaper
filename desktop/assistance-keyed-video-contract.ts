/* SPDX-License-Identifier: AGPL-3.0-only */

/** A closed alpha encoder: callers supply owned claims, never paths or codec arguments. */
import { validateAssistanceOutputClaim, type AssistanceOutputClaim } from './assistance-data-claims.ts';
import { guardExternalFfmpegVideoArguments } from './external-ffmpeg-video-process.ts';

export interface AssistanceKeyedVideoRequest {
	readonly contractVersion: 1;
	readonly jobId: string;
	readonly sourceId: string;
	readonly frameRate: Readonly<{ num: number; den: number }>;
	readonly outputs: readonly AssistanceOutputClaim[];
}
export interface AssistanceKeyedVideoPlan {
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
	readonly frameRate: Readonly<{ num: number; den: number }>;
	readonly timescale: number;
	readonly presentationTicks: readonly string[];
}

export function validateAssistanceKeyedVideoRequest(value: unknown): AssistanceKeyedVideoRequest {
	const record = exact(value, ['contractVersion', 'jobId', 'sourceId', 'frameRate', 'outputs']);
	if (record.contractVersion !== 1 || typeof record.jobId !== 'string' || !/^[a-f\d]{40}$/u.test(record.jobId)
		|| typeof record.sourceId !== 'string' || record.sourceId.length < 1 || record.sourceId.length > 256
		|| [...record.sourceId].some((character) => character.charCodeAt(0) < 32)) throw new TypeError('The keyed-video job or source binding is invalid.');
	const rate = exact(record.frameRate, ['num', 'den']);
	for (const part of [rate.num, rate.den]) {
		if (!Number.isSafeInteger(part) || Number(part) < 1 || Number(part) > 0x7fff_ffff) throw new TypeError('The keyed-video rate is invalid.');
	}
	if (Number(rate.num) / Number(rate.den) > 240 || Number(rate.num) / Number(rate.den) < 0.1) {
		throw new RangeError('The keyed-video rate exceeds its maintained bound.');
	}
	if (!Array.isArray(record.outputs) || record.outputs.length < 1 || record.outputs.length > 63) {
		throw new RangeError('The keyed-video frame claim inventory is invalid.');
	}
	const outputs = record.outputs.map((item: unknown) => validateAssistanceOutputClaim(item));
	if (new Set(outputs.map((claim) => claim.claimId)).size !== outputs.length || outputs.some((claim) =>
		claim.jobId !== record.jobId || claim.role !== 'keyed-frames' || claim.byteLength > 512 * 1024 ** 2)) {
		throw new TypeError('Keyed-video inputs must be distinct full-raster claims from this job.');
	}
	return Object.freeze({ contractVersion: 1, jobId: record.jobId, sourceId: record.sourceId,
		frameRate: Object.freeze({ num: Number(rate.num), den: Number(rate.den) }), outputs: Object.freeze(outputs) });
}

export function keyedVideoEncodeArguments(
	plan: Pick<AssistanceKeyedVideoPlan, 'width' | 'height' | 'frameCount' | 'frameRate'>,
	outputPath: string,
	maximumBytes: number,
): readonly string[] {
	return guardExternalFfmpegVideoArguments([
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', `${String(plan.width)}x${String(plan.height)}`,
		'-framerate', `${String(plan.frameRate.num)}/${String(plan.frameRate.den)}`, '-i', 'pipe:3',
		'-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1',
		'-vf', 'split=2[c][a];[c]format=yuv420p[y];[a]alphaextract[alpha];[y][alpha]alphamerge',
		'-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-lossless', '1', '-auto-alt-ref', '0',
		'-b:v', '0', '-crf', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
		'-frames:v', String(plan.frameCount), '-fps_mode', 'passthrough', '-f', 'webm', outputPath,
	], maximumBytes);
}

/** Probe actual packets; WebM's millisecond timebase may quantize a rational CFR. */
export function inspectKeyedVideoProbe(value: unknown, plan: AssistanceKeyedVideoPlan) {
	const probe = record(value);
	if (!Array.isArray(probe.streams) || probe.streams.length !== 1 || !Array.isArray(probe.packets)
		|| probe.packets.length !== plan.frameCount) throw new Error('Encoded keyed-video stream or frame count changed.');
	const stream = record(probe.streams[0]); const tags = record(stream.tags);
	if (stream.codec_type !== 'video' || stream.codec_name !== 'vp9' || stream.width !== plan.width
		|| stream.height !== plan.height || String(tags.alpha_mode) !== '1') {
		throw new Error('Encoded keyed-video geometry, codec or alpha metadata changed.');
	}
	const [timeNum, timescale] = rational(stream.time_base);
	const [rateNum, rateDen] = rational(stream.r_frame_rate);
	// WebM DefaultDuration is integral nanoseconds, so a probed rational can
	// differ slightly from the canonical source rate (notably 60000/1001).
	const rateDifference = BigInt(rateNum) * BigInt(plan.frameRate.den) - BigInt(rateDen) * BigInt(plan.frameRate.num);
	if ((rateDifference < 0n ? -rateDifference : rateDifference) * 1_000_000_000n > BigInt(rateNum) * BigInt(plan.frameRate.num)) {
		throw new Error('Encoded keyed-video nominal rational rate changed.');
	}
	const ticks = probe.packets.map((packet: unknown, ordinal: number) => {
		const raw = record(packet); const tick = BigInt(unsignedInteger(raw.pts)) * BigInt(timeNum);
		const source = BigInt(plan.presentationTicks[ordinal]!);
		if (!withinMillisecond(tick, timescale, source, plan.timescale)
			|| !withinMillisecond(tick, timescale, BigInt(ordinal) * BigInt(plan.frameRate.den), plan.frameRate.num)) {
			throw new Error('Encoded keyed-video packet timing changed by more than one millisecond.');
		}
		return tick.toString();
	});
	if (ticks[0] !== '0' || ticks.some((tick, index) => index > 0 && BigInt(tick) <= BigInt(ticks[index - 1]!))) {
		throw new Error('Encoded keyed-video presentation ordinals changed.');
	}
	const last = record(probe.packets.at(-1));
	const packetDuration = BigInt(unsignedInteger(last.duration)) * BigInt(timeNum);
	// Packet duration is truncated to the stream timebase. WebM's measured
	// container duration retains the rounded end timestamp, including that tail.
	const endTick = containerDurationTick(record(probe.format).duration, timescale);
	const duration = endTick - BigInt(ticks.at(-1)!);
	if (packetDuration < 1n || !withinMillisecond(packetDuration, timescale, BigInt(plan.frameRate.den), plan.frameRate.num)
		|| duration < 1n || !withinMillisecond(duration, timescale, BigInt(plan.frameRate.den), plan.frameRate.num)
		|| !withinMillisecond(endTick, timescale, BigInt(plan.frameCount) * BigInt(plan.frameRate.den), plan.frameRate.num)) {
		throw new Error('Encoded keyed-video final frame duration changed.');
	}
	return Object.freeze({ width: plan.width, height: plan.height, frameCount: plan.frameCount,
		frameRate: plan.frameRate, timing: Object.freeze({ timescale, presentationTicks: Object.freeze(ticks), finalFrameDurationTicks: String(duration) }),
		characteristics: Object.freeze({ videoCodec: 'vp9', hasAlpha: true, bitDepth: 8, pixelFormat: 'yuva420p',
			colorPrimaries: optionalText(stream.color_primaries), colorTransfer: optionalText(stream.color_transfer),
			colorSpace: optionalText(stream.color_space), colorRange: optionalText(stream.color_range) === 'tv' ? 'limited' : null }),
	});
}

export function withinMillisecond(left: bigint, leftScale: number, right: bigint, rightScale: number): boolean {
	const delta = left * BigInt(rightScale) - right * BigInt(leftScale);
	return (delta < 0n ? -delta : delta) * 1000n <= BigInt(leftScale) * BigInt(rightScale);
}
function rational(value: unknown): readonly [number, number] {
	if (typeof value !== 'string' || !/^[1-9]\d*\/[1-9]\d*$/u.test(value)) throw new TypeError('Invalid keyed-video rational.');
	const parts = value.split('/').map(Number);
	if (parts.some((part) => !Number.isSafeInteger(part) || part > 0x7fff_ffff)) throw new TypeError('Unbounded keyed-video rational.');
	return [parts[0]!, parts[1]!];
}
function unsignedInteger(value: unknown): string {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
	if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value) && BigInt(value) <= 0x7fff_ffff_ffff_ffffn) return value;
	throw new TypeError('Invalid keyed-video packet timestamp.');
}
function containerDurationTick(value: unknown, timescale: number): bigint {
	if (typeof value !== 'string' || value.length > 32 || !/^(?:0|[1-9]\d*)\.\d{1,9}$/u.test(value)) {
		throw new TypeError('Invalid keyed-video container duration.');
	}
	const [seconds, fraction] = value.split('.') as [string, string];
	const denominator = 10n ** BigInt(fraction.length);
	const numerator = BigInt(seconds + fraction) * BigInt(timescale);
	if (numerator % denominator !== 0n || numerator / denominator > 0x7fff_ffff_ffff_ffffn) {
		throw new RangeError('The keyed-video container duration exceeds its exact timebase.');
	}
	return numerator / denominator;
}
function optionalText(value: unknown): string | null { return typeof value === 'string' && value !== 'unknown' ? value : null; }
function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) throw new TypeError('Invalid keyed-video record.');
	return value as Readonly<Record<string, unknown>>;
}
function exact(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
	const result = record(value);
	if (Object.keys(result).length !== keys.length || Object.keys(result).some((key) => !keys.includes(key))) throw new TypeError('Unsupported keyed-video fields.');
	return result;
}
