/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalAssistanceBridge, LocalAssistanceModel, LocalAssistanceOutputClaim,
	LocalAssistanceOutputReservation } from '../../../../assistance/local-assistance-bridge.ts';
import { normalizeCorridorKeyHintSettings, type CorridorKeyHintSettings } from '../../../../assistance/corridorkey-hint-settings.ts';
import { reviewAssistanceVisualFramePackV2 } from '../../../../assistance/visual-frame-pack-v2.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../../../media/content-digest.ts';
import type { LocalAssistanceKeyedVideoResult, LocalAssistanceVideoKeyingPublication,
	LocalAssistanceVideoKeyingRun } from './local-assistance-video-keying-publication.ts';
import { assertKeyingStagedBudget, keyingEncodedReservationBytes } from './local-assistance-video-keying-budget.ts';

export const CORRIDORKEY_MODEL_ID = 'corridorkey-2.0';
export const CORRIDORKEY_MODEL_VERSION = '2.0.0';
export const KEYING_FRAME_PACK_TYPE = 'application/vnd.soundscaper.frame-pack';
export const KEYING_MAXIMUM_PACK_BYTES = 128 * 1024 * 1024;

export interface VideoKeyingProgress {
	readonly phase: 'decoding' | 'running' | 'encoding' | 'publishing';
	readonly completed: number | null;
	readonly total: number | null;
}
export interface VideoKeyingWorkflowOptions {
	readonly hint?: CorridorKeyHintSettings;
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: VideoKeyingProgress) => void;
}
export interface VideoKeyingEncodeRequest {
	readonly jobId: string;
	readonly run: LocalAssistanceVideoKeyingRun;
	readonly outputs: readonly LocalAssistanceOutputClaim[];
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}
export interface LocalAssistanceVideoKeyingWorkflowDependencies {
	readonly publication: LocalAssistanceVideoKeyingPublication;
	readonly bridge: LocalAssistanceBridge;
	/** The existing Model Manager must confirm the exact model is offered and installed. */
	readonly preflightModel: (signal: AbortSignal) => Promise<LocalAssistanceModel>;
	readonly prepareFrames: (run: LocalAssistanceVideoKeyingRun, options: Readonly<{
		signal: AbortSignal; assertCurrent: () => void; onProgress?: (value: VideoKeyingProgress) => void;
	}>) => AsyncIterable<Blob>;
	readonly encodeAlphaWebm: (request: VideoKeyingEncodeRequest) => Promise<LocalAssistanceKeyedVideoResult>;
}
interface PackAuthority { readonly first: number; readonly count: number; readonly byteLength: number }

/** Every decoded source frame stays under the original capture until one history admission. */
export function createLocalAssistanceVideoKeyingWorkflow(dependencies: LocalAssistanceVideoKeyingWorkflowDependencies) {
	let active = false;
	return Object.freeze({ async run(options: VideoKeyingWorkflowOptions = {}): Promise<Readonly<{ sourceId: string }>> {
		if (active) throw new Error('CorridorKey is already processing a source.');
		const hint = options.hint === undefined ? undefined : normalizeCorridorKeyHintSettings(options.hint);
		active = true;
		const signal = options.signal ?? new AbortController().signal;
		let jobId: string | null = null;
		let unsubscribe = (): void => undefined;
		let cancellation: Promise<unknown> | null = null;
		let cancellationFailure: unknown;
		const cancel = (): void => { if (jobId) cancellation ??= dependencies.bridge.cancel(jobId)
			.catch((error: unknown) => { cancellationFailure = error; }); };
		let failure: unknown;
		let accepted: Readonly<{ sourceId: string }> | undefined;
		try {
			signal.throwIfAborted();
			const captured = await dependencies.publication.capture({ signal });
			const encodedReservation = keyingEncodedReservationBytes(captured.width, captured.height, captured.sourceFrameCount);
			const assertCurrent = (): void => { signal.throwIfAborted(); dependencies.publication.assertCurrent(captured, signal); };
			assertCurrent();
			const characteristics = captured.source.characteristics as Readonly<Record<string, unknown>> | undefined;
			const colour = characteristics?.colour as Readonly<Record<string, unknown>> | undefined;
			if (characteristics?.hasAlpha === true) throw new Error('CorridorKey currently requires an opaque source without an existing alpha channel.');
			const transfer = typeof colour?.transfer === 'string' ? colour.transfer.trim().toLowerCase().replace(/[\s._]+/gu, '-') : '';
			if (['pq', 'smpte2084', 'smpte-st-2084', 'hlg', 'arib-std-b67', 'linear', 'scene-linear'].includes(transfer)) {
				throw new Error('CorridorKey currently supports display-referred SDR video; HDR and scene-linear sources are unavailable.');
			}
			const model = await dependencies.preflightModel(signal);
			assertCurrent();
			assertModel(model);
			const authenticated = (await dependencies.bridge.models()).filter((candidate) => (
				candidate.modelId === model.modelId && candidate.version === model.version
				&& candidate.task === 'video-keying' && JSON.stringify(candidate.artifactSha256s) === JSON.stringify(model.artifactSha256s)
			));
			assertCurrent();
			if (authenticated.length !== 1) throw new Error('The authenticated CorridorKey model binding is unavailable.');
			const created = await dependencies.bridge.createJob();
			jobId = created.jobId;
			signal.addEventListener('abort', cancel, { once: true });
			if (signal.aborted) cancel();
			assertCurrent();
			unsubscribe = dependencies.bridge.onProgress((progress) => {
				if (progress.jobId === jobId && progress.operation === 'video-keying') {
					options.onProgress?.({ phase: 'running', completed: progress.completed, total: progress.total });
				}
			});
			const inputs = [];
			const outputs: LocalAssistanceOutputReservation[] = [];
			const packs: PackAuthority[] = [];
			let count = 0; let aggregate = 0;
			for await (const value of dependencies.prepareFrames(captured, { signal, assertCurrent, onProgress: options.onProgress })) {
				assertCurrent();
				const body = canonicalMediaContentBlob(value);
				aggregate += body.size;
				assertKeyingStagedBudget(aggregate, packs.length + 1, encodedReservation);
				const authority = await reviewPack(body, captured, count);
				assertCurrent();
				inputs.push(await dependencies.bridge.stageInput({ jobId, role: 'frame-pack', mediaType: KEYING_FRAME_PACK_TYPE,
					byteLength: body.size, bytes: body }));
				assertCurrent();
				outputs.push(await dependencies.bridge.reserveOutput({ jobId, role: 'keyed-frames', mediaType: KEYING_FRAME_PACK_TYPE,
					maximumByteLength: body.size }));
				assertCurrent(); packs.push(authority); count += authority.count;
			}
			if (count !== captured.sourceFrameCount || packs.length === 0) throw new RangeError('CorridorKey preparation omitted source frames.');
			assertCurrent();
			const outcome = await dependencies.bridge.run({ contractVersion: 1, jobId, operation: 'video-keying',
				selectionFence: captured.selectionFence, ...(hint ? { settings: hint } : {}), models: [{ modelId: model.modelId, version: model.version,
					artifactSha256s: model.artifactSha256s }], inputs, outputs });
			assertCurrent();
			if (outcome.outcome !== 'completed') throw new Error(outcome.outcome === 'unavailable'
				? `CorridorKey is unavailable: ${outcome.reason}.` : 'CorridorKey processing consent was declined.');
			const claims = new Map(outcome.result.outputs.map((claim) => [claim.claimId, claim]));
			if (claims.size !== outputs.length) throw new Error('CorridorKey returned an incomplete output inventory.');
			const ordered: LocalAssistanceOutputClaim[] = [];
			for (let index = 0; index < outputs.length; index += 1) {
				assertCurrent();
				const reservation = outputs[index]!; const expected = packs[index]!;
				const claim = claims.get(reservation.claimId);
				if (!claim || claim.jobId !== jobId || claim.role !== 'keyed-frames' || claim.mediaType !== KEYING_FRAME_PACK_TYPE
					|| claim.byteLength !== expected.byteLength) throw new Error('CorridorKey output changed its exact claim inventory.');
				const body = canonicalMediaContentBlob(await dependencies.bridge.readOutput({ jobId, claim }));
				assertCurrent();
				if (body.size !== claim.byteLength || await digestMediaContent(body, { signal }) !== claim.sha256) {
					throw new Error('CorridorKey output bytes disagree with their authenticated claim.');
				}
				const reviewed = await reviewPack(body, captured, expected.first);
				if (reviewed.count !== expected.count) throw new Error('CorridorKey output frame inventory changed.');
				assertCurrent(); ordered.push(claim);
			}
			options.onProgress?.({ phase: 'encoding', completed: null, total: null });
			assertCurrent();
			const encoded = await dependencies.encodeAlphaWebm({ jobId, run: captured, outputs: ordered, signal, assertCurrent });
			assertCurrent(); options.onProgress?.({ phase: 'publishing', completed: null, total: null });
			accepted = await dependencies.publication.accept(captured, encoded, { signal });
		} catch (error) { failure = error; }
		finally {
			const cleanup: unknown[] = [];
			signal.removeEventListener('abort', cancel);
			try { unsubscribe(); } catch (error) { cleanup.push(error); }
			if (cancellation) await cancellation;
			if (cancellationFailure !== undefined) cleanup.push(cancellationFailure);
			if (jobId) { try { await dependencies.bridge.release(jobId); } catch (error) { cleanup.push(error); } }
			active = false;
			if (cleanup.length) failure = new AggregateError(failure === undefined ? cleanup : [failure, ...cleanup],
				'CorridorKey processing and claim cleanup failed.', failure === undefined ? undefined : { cause: failure });
		}
		if (failure !== undefined) throw failure;
		if (!accepted) throw new Error('CorridorKey returned no accepted derivative.');
		return accepted;
	} });
}

async function reviewPack(body: Blob, captured: LocalAssistanceVideoKeyingRun, first: number): Promise<PackAuthority> {
	if (body.type !== KEYING_FRAME_PACK_TYPE || body.size < 1 || body.size > KEYING_MAXIMUM_PACK_BYTES) {
		throw new RangeError('CorridorKey requires bounded full-raster frame packs.');
	}
	const pack = reviewAssistanceVisualFramePackV2(new Uint8Array(await body.arrayBuffer()));
	if (pack.sourceWidth !== captured.width || pack.rasterWidth !== captured.width
		|| pack.sourceHeight !== captured.height || pack.rasterHeight !== captured.height
		|| pack.timescale !== captured.timescale || pack.frameCount < 1) throw new Error('CorridorKey frame-pack geometry changed.');
	for (let index = 0; index < pack.frameCount; index += 1) {
		const frame = pack.frameTiming(index); const ordinal = first + index;
		if (ordinal >= captured.sourceFrameCount || frame.sourceFrame !== ordinal
			|| frame.presentationTick !== captured.presentationTick(ordinal).toString()) throw new Error('CorridorKey frame-pack source timing changed.');
	}
	return { first, count: pack.frameCount, byteLength: body.size };
}
function assertModel(model: LocalAssistanceModel): void {
	if (model.modelId !== CORRIDORKEY_MODEL_ID || model.version !== CORRIDORKEY_MODEL_VERSION || model.task !== 'video-keying'
		|| model.artifactSha256s.length !== 5 || model.artifactSha256s.some((sha) => !/^[a-f0-9]{64}$/u.test(sha))) {
		throw new Error('The complete authenticated CorridorKey 2.0 model is unavailable.');
	}
}
