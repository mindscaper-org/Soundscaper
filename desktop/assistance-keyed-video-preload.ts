/* SPDX-License-Identifier: AGPL-3.0-only */

/** Sandbox-safe projection of the one fixed alpha-video encode capability. */
import type { AssistanceOutputClaim } from './assistance-data-claims.ts';

const CHANNEL = 'soundscaper:v1:assistance:operation:encode-keyed-video';
const CLAIM_KEYS = ['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256'];

export function createAssistanceKeyedVideoPreloadBridge(options: Readonly<{
	invoke: (channel: string, value: unknown) => Promise<unknown>;
	claim: (value: unknown) => AssistanceOutputClaim;
}>) {
	return Object.freeze({ async available(): Promise<boolean> {
		const value = await options.invoke('soundscaper:v1:assistance:operation:keyed-video-available', undefined);
		if (typeof value !== 'boolean') throw new TypeError('Invalid keyed-video availability.');
		return value;
	}, async encode(value: unknown) {
		const raw = exact(value, ['contractVersion', 'jobId', 'sourceId', 'frameRate', 'outputs']);
		const jobId = id(raw.jobId); const sourceId = text(raw.sourceId, 256);
		const rate = exact(raw.frameRate, ['num', 'den']);
		const frameRate = Object.freeze({ num: integer(rate.num, 1, 0x7fff_ffff), den: integer(rate.den, 1, 0x7fff_ffff) });
		if (raw.contractVersion !== 1 || !Array.isArray(raw.outputs) || raw.outputs.length < 1 || raw.outputs.length > 63) {
			throw new TypeError('The keyed-video request is invalid.');
		}
		const outputs = raw.outputs.map((item: unknown) => {
			exact(item, CLAIM_KEYS); const claim = options.claim(item);
			if (claim.jobId !== jobId || claim.role !== 'keyed-frames') throw new TypeError('Invalid keyed-video frame custody.');
			return claim;
		});
		if (new Set(outputs.map((claim) => claim.claimId)).size !== outputs.length) throw new TypeError('Repeated keyed-video frame claim.');
		const result = exact(await options.invoke(CHANNEL, { contractVersion: 1, jobId, sourceId, frameRate, outputs }),
			['contractVersion', 'jobId', 'sourceId', 'claim', 'inspection']);
		if (result.contractVersion !== 1 || result.jobId !== jobId || result.sourceId !== sourceId) throw new TypeError('Invalid keyed-video result binding.');
		exact(result.claim, CLAIM_KEYS); const claim = options.claim(result.claim);
		if (claim.role !== 'keyed-video' || claim.mediaType !== 'video/webm' || claim.jobId !== jobId) throw new TypeError('Invalid keyed-video output custody.');
		const inspected = exact(result.inspection, ['width', 'height', 'frameCount', 'frameRate', 'timing', 'characteristics', 'sha256']);
		const inspectedRate = exact(inspected.frameRate, ['num', 'den']);
		if (inspected.sha256 !== claim.sha256 || inspectedRate.num !== frameRate.num || inspectedRate.den !== frameRate.den) throw new TypeError('Invalid keyed-video inspection binding.');
		const timing = exact(inspected.timing, ['timescale', 'presentationTicks', 'finalFrameDurationTicks']);
		const count = integer(inspected.frameCount, 1, 100_000);
		if (!Array.isArray(timing.presentationTicks) || timing.presentationTicks.length !== count) throw new TypeError('Invalid keyed-video timing count.');
		const characteristics = exact(inspected.characteristics, ['videoCodec', 'hasAlpha', 'bitDepth', 'pixelFormat',
			'colorPrimaries', 'colorTransfer', 'colorSpace', 'colorRange']);
		if (characteristics.videoCodec !== 'vp9' || characteristics.hasAlpha !== true || characteristics.bitDepth !== 8
			|| characteristics.pixelFormat !== 'yuva420p') throw new TypeError('Invalid keyed-video alpha inspection.');
		return Object.freeze({ contractVersion: 1, jobId, sourceId, claim,
			inspection: Object.freeze({ width: integer(inspected.width, 1, 4096), height: integer(inspected.height, 1, 4096),
				frameCount: count, frameRate, sha256: claim.sha256,
				timing: Object.freeze({ timescale: integer(timing.timescale, 1, 0x7fff_ffff),
					presentationTicks: Object.freeze(timing.presentationTicks.map((tick: unknown) => tickText(tick))),
					finalFrameDurationTicks: tickText(timing.finalFrameDurationTicks) }),
				characteristics: Object.freeze({ videoCodec: 'vp9', hasAlpha: true, bitDepth: 8, pixelFormat: 'yuva420p',
					colorPrimaries: optionalText(characteristics.colorPrimaries), colorTransfer: optionalText(characteristics.colorTransfer),
					colorSpace: optionalText(characteristics.colorSpace), colorRange: optionalText(characteristics.colorRange) }),
			}) });
	} });
}
function exact(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) throw new TypeError('Invalid keyed-video record.');
	const record = value as Readonly<Record<string, unknown>>;
	if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) throw new TypeError('Unsupported keyed-video fields.');
	return record;
}
function integer(value: unknown, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new TypeError('Invalid keyed-video integer.');
	return Number(value);
}
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) throw new TypeError('Invalid keyed-video identity.');
	return value;
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum
		|| [...value].some((character) => character.charCodeAt(0) < 32)) throw new TypeError('Invalid keyed-video text.');
	return value;
}
function tickText(value: unknown): string {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value) || value.length > 19
		|| BigInt(value) > 0x7fff_ffff_ffff_ffffn) throw new TypeError('Invalid keyed-video tick.');
	return value;
}
function optionalText(value: unknown): string | null { return value === null ? null : text(value, 64); }
