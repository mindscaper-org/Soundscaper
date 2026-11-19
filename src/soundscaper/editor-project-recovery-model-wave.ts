/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAssistanceAssetReferenceV1 } from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { createDigest, hex } from '../common/media/bytes.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type LegacyModelWaveBitDepth = 16 | 32;
const SHA256 = /^[a-f0-9]{64}$/u;
const CLAIM_ID = /^[a-f0-9]{40}$/u;
const HEADER_BYTES = 44;
const PCM16_SCALE = 32_768;

/** Older generated audio sometimes records the reviewed WAV identity on its stored source. */
export function legacyRecoveryModelWaveBitDepth(project: DataRecord, source: DataRecord): LegacyModelWaveBitDepth | null {
	const { byteLength, frameCount, channelCount, sampleRate, contentSha256 } = source;
	if (source.mimeType !== 'audio/wav' || source.sampleFormat !== 'float32'
		|| source.originalSampleRate !== sampleRate || typeof frameCount !== 'number'
		|| !Number.isSafeInteger(frameCount) || frameCount < 1 || typeof channelCount !== 'number'
		|| !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 64
		|| typeof contentSha256 !== 'string' || !SHA256.test(contentSha256)
		|| typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength - 8 > 0xffff_ffff) return null;
	const floatLength = HEADER_BYTES + frameCount * channelCount * 4;
	if (byteLength === floatLength && matchesEffectWaveReceipt(source, contentSha256, byteLength)) return 32;
	if (sampleRate !== 24_000 || channelCount !== 1 || !Array.isArray(project.assistanceAssets)) return null;
	const bitDepth = byteLength === HEADER_BYTES + frameCount * 2 ? 16 : byteLength === floatLength ? 32 : null;
	if (bitDepth === null) return null;
	for (const value of project.assistanceAssets) {
		const candidate = record(value);
		if (candidate?.kind !== 'tts-script-v1' || candidate.sourceId !== source.id) continue;
		try {
			const script = createAssistanceAssetReferenceV1(value);
			if (script.sourceSha256 === contentSha256 && script.sourceStartFrame === 0
				&& script.sourceEndFrame === frameCount && script.sourceVideoTimingSha256 === null
				&& script.recipeId === 'kokoro-text-to-speech' && script.recipeVersion === 1) return bitDepth;
		} catch { /* A damaged script reference cannot supply a legacy waveform identity. */ }
	}
	return null;
}

function matchesEffectWaveReceipt(source: DataRecord, digest: string, byteLength: number): boolean {
	const result = record(record(source.opaqueExtensions)?.['org.soundscaper.local-assistance-audio-v1']);
	const claim = record(result?.outputClaim);
	if (result?.version !== 1 || claim?.claimVersion !== 1 || claim.mediaType !== 'audio/wav'
		|| claim.sha256 !== digest || claim.byteLength !== byteLength
		|| typeof claim.claimId !== 'string' || !CLAIM_ID.test(claim.claimId)
		|| typeof claim.jobId !== 'string' || !CLAIM_ID.test(claim.jobId)) return false;
	switch (result.operation) {
		case 'speech-enhancement': return source.sampleRate === 48_000
			&& result.slotId === 'enhanced-audio' && claim.role === 'enhanced-audio';
		case 'dereverberation': return source.sampleRate === 44_100
			&& result.slotId === 'dereverberated-audio' && claim.role === 'enhanced-audio';
		case 'source-separation': return source.sampleRate === 44_100 && claim.role === 'separated-audio'
			&& (result.slotId === 'dialogue' || result.slotId === 'music' || result.slotId === 'effects');
		default: return false;
	}
}

/** Reconstruct and hash the exact old transport bytes without reading or retaining the source twice. */
export async function createRecoveryModelWaveVerifier(source: DataRecord, bitDepth: LegacyModelWaveBitDepth) {
	const { createWavStreamEncoder } = await import('../common/editor/wav.js');
	const digest = createDigest();
	const encoder = createWavStreamEncoder({
		sampleRate: Number(source.sampleRate), channelCount: Number(source.channelCount),
		totalFrames: Number(source.frameCount), bitDepth, float: bitDepth === 32, dither: false, collect: false,
		onChunk(bytes) { digest.update(bytes); },
	});
	let exact = true;
	return {
		write(channels: readonly Float32Array[]) {
			if (!exact) return;
			exact = channels.every(channel => bitDepth === 16 ? channel.every(sample =>
				Number.isInteger(sample * PCM16_SCALE) && sample >= -1 && sample < 1 && !Object.is(sample, -0))
				: channel.every(Number.isFinite));
			if (exact) encoder.write(channels);
		},
		matches() {
			if (!exact) return false;
			encoder.finalize();
			return encoder.byteLength === source.byteLength && hex(digest.digest()) === source.contentSha256;
		},
	};
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}
