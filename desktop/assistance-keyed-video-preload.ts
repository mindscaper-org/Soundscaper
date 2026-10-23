/* SPDX-License-Identifier: AGPL-3.0-only */

/** Sandbox-safe projection of the one fixed alpha-video encode capability. */
interface KeyedVideoPreloadClaim {
	readonly claimVersion: 1;
	readonly claimId: string;
	readonly jobId: string;
	readonly role: string;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

const CHANNEL = 'soundscaper:v1:assistance:operation:encode-keyed-video';
const CLAIM_KEYS = ['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256'];

export function createAssistanceKeyedVideoPreloadBridge(options: Readonly<{
	invoke: (channel: string, value: unknown) => Promise<unknown>;
	claim: (value: unknown) => KeyedVideoPreloadClaim;
}>) {
	return Object.freeze({ async available(): Promise<boolean> {
		const value = await options.invoke('soundscaper:v1:assistance:operation:keyed-video-available', undefined);
		if (typeof value !== 'boolean') throw new TypeError('Invalid keyed-video availability.');
		return value;

	}, async decodeSource(value: unknown) {
		const raw = exact(value, ['contractVersion', 'jobId', 'source', 'width', 'height', 'frameCount', 'frameRate']);
		const jobId = id(raw.jobId); const source = exact(raw.source, CLAIM_KEYS);
		if (raw.contractVersion !== 1 || source.claimVersion !== 1 || source.jobId !== jobId || source.role !== 'video'
			|| !['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'application/mxf'].includes(String(source.mediaType))) throw new TypeError('Invalid native keying source custody.');
		id(source.claimId); if (typeof source.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(source.sha256)) throw new TypeError('Invalid native keying source digest.');
		integer(source.byteLength, 1, 8 * 1024 ** 3);
		const rate = exact(raw.frameRate, ['num', 'den']);
		const request = { contractVersion: 1, jobId, source: { ...source }, width: integer(raw.width, 1, 4096), height: integer(raw.height, 1, 4096),
			frameCount: integer(raw.frameCount, 1, 100_000), frameRate: { num: integer(rate.num, 1, 0x7fff_ffff), den: integer(rate.den, 1, 0x7fff_ffff) } };
		const result = exact(await options.invoke('soundscaper:v1:assistance:operation:decode-keying-source', request),
			['contractVersion', 'jobId', 'sourceSha256', 'width', 'height', 'frameCount', 'byteLength']);
		if (result.contractVersion !== 1 || result.jobId !== jobId || result.sourceSha256 !== source.sha256
			|| result.width !== request.width || result.height !== request.height || result.frameCount !== request.frameCount
			|| result.byteLength !== request.width * request.height * request.frameCount * 4) throw new TypeError('Invalid native keying source decode binding.');
		return Object.freeze({ ...result });
	}, async readDecodedSource(value: unknown): Promise<Uint8Array> {
		const raw = exact(value, ['jobId', 'offset', 'maximumBytes']);
		const request = { jobId: id(raw.jobId), offset: integer(raw.offset, 0, 8 * 1024 ** 3), maximumBytes: integer(raw.maximumBytes, 1, 4 * 1024 ** 2) };
		const bytes = await options.invoke('soundscaper:v1:assistance:operation:read-keying-source', request);
		if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > request.maximumBytes) throw new TypeError('Invalid native source decode range.');
		return Uint8Array.from(bytes);
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
