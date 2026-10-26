/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazyKeyingSourceDecodeBridge, type KeyingSourceDecodeBridge } from './local-assistance-video-keying-decode-bridge.ts';
import type { LocalAssistanceOutputClaim } from './local-assistance-bridge.ts';
import type { LocalAssistanceKeyedVideoInspection } from '../controller/assistance/local-assistance-video-keying.ts';
import { createUnreportedVideoSourceCharacteristicsV25, normalizeVideoSourceCharacteristicsV25 } from '../video-source-professional-characteristics-v25.ts';
import { decodeVideoTimingAsset, encodeVideoTimingAsset } from '../video-timing-asset.ts';

export interface LocalAssistanceVideoKeyingEncodeRequest {
	readonly contractVersion: 1;
	readonly jobId: string;
	readonly sourceId: string;
	readonly frameRate: Readonly<{ num: number; den: number }>;
	readonly outputs: readonly LocalAssistanceOutputClaim[];
}
export interface LocalAssistanceVideoKeyingEncodeResult {
	readonly contractVersion: 1;
	readonly jobId: string;
	readonly sourceId: string;
	readonly claim: LocalAssistanceOutputClaim;
	readonly inspection: LocalAssistanceKeyedVideoInspection & Readonly<{ sha256: string }>;
}
export interface LocalAssistanceVideoKeyingBridge extends Partial<KeyingSourceDecodeBridge> {
	available(): Promise<boolean>;
	encode(request: LocalAssistanceVideoKeyingEncodeRequest): Promise<LocalAssistanceVideoKeyingEncodeResult>;
}

/** This optional capability grants only one fixed alpha-video encode over existing job-owned claims. */
export function lazyLocalAssistanceVideoKeyingBridge(value: unknown): LocalAssistanceVideoKeyingBridge | null {
	if (!value || typeof value !== 'object' || !('encode' in value) || typeof value.encode !== 'function'
		|| !('available' in value) || typeof value.available !== 'function') return null;
	const encode = value.encode as (request: LocalAssistanceVideoKeyingEncodeRequest) => Promise<unknown>;
	const available = value.available as () => Promise<unknown>;
	return Object.freeze({ ...lazyKeyingSourceDecodeBridge(value), async available() {
		const result = await available.call(value);
		if (typeof result !== 'boolean') throw new TypeError('The keyed-video encoder availability response is invalid.');
		return result;
	}, async encode(request: LocalAssistanceVideoKeyingEncodeRequest) {
		const result = record(await encode.call(value, request));
		if (result.contractVersion !== 1 || result.jobId !== request.jobId || result.sourceId !== request.sourceId) {
			throw new Error('The keyed-video encode result lost its source or job binding.');
		}
		const claim = record(result.claim);
		const inspection = record(result.inspection);
		const frameRate = record(inspection.frameRate);
		if (claim.claimVersion !== 1 || claim.jobId !== request.jobId || claim.role !== 'keyed-video'
			|| claim.mediaType !== 'video/webm' || typeof claim.claimId !== 'string' || !/^[a-f0-9]{40}$/u.test(claim.claimId)
			|| typeof claim.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(claim.sha256)
			|| claim.sha256 !== inspection.sha256 || !Number.isSafeInteger(claim.byteLength) || Number(claim.byteLength) < 1
			|| Number(claim.byteLength) > 8 * 1024 ** 3 || frameRate.num !== request.frameRate.num || frameRate.den !== request.frameRate.den) {
			throw new Error('The encoded alpha-video claim disagrees with its inspected content.');
		}
		const raw = record(inspection.timing); const characteristics = record(inspection.characteristics);
		if (!Array.isArray(raw.presentationTicks) || raw.presentationTicks.some((tick) => typeof tick !== 'string'
			|| !/^(?:0|[1-9]\d*)$/u.test(tick)) || typeof raw.finalFrameDurationTicks !== 'string'
			|| !/^[1-9]\d*$/u.test(raw.finalFrameDurationTicks)) throw new TypeError('The encoded alpha-video timing is invalid.');
		const timing = decodeVideoTimingAsset(encodeVideoTimingAsset({ timescale: Number(raw.timescale),
			presentationTicks: raw.presentationTicks.map((tick: string) => BigInt(tick)),
			finalFrameDurationTicks: BigInt(raw.finalFrameDurationTicks) }));
		if (inspection.frameCount !== timing.frameCount || characteristics.videoCodec !== 'vp9'
			|| characteristics.hasAlpha !== true || characteristics.bitDepth !== 8 || characteristics.pixelFormat !== 'yuva420p') {
			throw new Error('The encoded video did not preserve its complete VP9 alpha raster.');
		}
		const unreported = createUnreportedVideoSourceCharacteristicsV25();
		const normalized = normalizeVideoSourceCharacteristicsV25({ ...unreported,
			backend: 'ffmpeg', codedWidth: inspection.width, codedHeight: inspection.height, rotationDegrees: 0,
			pixelAspectRatio: { num: 1, den: 1 }, fieldOrder: 'progressive', videoCodec: 'vp9', hasAlpha: true,
			audioStreams: [],
			bitDepth: 8, pixelFormat: 'yuva420p', chromaFormat: '4:2:0', alphaMode: 'straight', alphaInterpretation: 'transparency',
			colour: { ...unreported.colour, primaries: characteristics.colorPrimaries, transfer: characteristics.colorTransfer,
				matrix: characteristics.colorSpace, range: characteristics.colorRange },
		}, { rate: request.frameRate });
		return Object.freeze({ contractVersion: 1 as const, jobId: request.jobId, sourceId: request.sourceId,
			claim: Object.freeze({ claimVersion: 1 as const, jobId: request.jobId, claimId: claim.claimId,
				role: 'keyed-video' as const, mediaType: 'video/webm', byteLength: Number(claim.byteLength), sha256: claim.sha256 }),
			inspection: Object.freeze({ width: Number(inspection.width), height: Number(inspection.height),
				frameRate: request.frameRate, timing, characteristics: normalized, sha256: claim.sha256 }) });
	} });
}
function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('The keyed-video bridge returned an invalid record.');
	return value as Readonly<Record<string, unknown>>;
}
