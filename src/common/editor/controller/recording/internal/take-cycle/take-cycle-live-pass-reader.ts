/* SPDX-License-Identifier: AGPL-3.0-only */
import type { RawPcmSpoolRecord, RawPcmSpoolRepository } from '../../../../storage/raw-pcm-spool-repository.ts';
import { capturePlan } from './take-cycle-capture-spool-manifest.ts';
import type { TakeCycleCaptureDraft } from './take-cycle-capture-spool.ts';
import { takeCycleStableId as stableId } from '../../take-cycle-value-validation.ts';

type Repository = Pick<RawPcmSpoolRepository, 'chunk'> & Partial<Pick<RawPcmSpoolRepository, 'openReadSession'>>;
type Admitted = Readonly<{ record: RawPcmSpoolRecord; draft: TakeCycleCaptureDraft }>;

/** Reuse only this spool's normalized immutable drafts; every read still queries current storage. */
export function createTakeCycleLivePassReader(repository: Repository,
	admit: (draft: TakeCycleCaptureDraft) => Promise<Admitted>, isOwned: (draft: TakeCycleCaptureDraft) => boolean) {
	const prepared = new WeakMap<TakeCycleCaptureDraft, Promise<Awaited<ReturnType<typeof prepare>>>>();
	async function prepare(value: TakeCycleCaptureDraft) {
		const { record, draft } = await admit(value);
		const session = repository.openReadSession ? await repository.openReadSession(record) : {
			chunk: (index: number) => repository.chunk(record, index), assertCurrent: async () => { await admit(value); },
		};
		const plan = capturePlan(draft.lane), sourceById = new Map<string, TakeCycleCaptureDraft['sources'][number]>();
		for (const source of draft.sources) if (!sourceById.has(source.mediaId)) sourceById.set(source.mediaId, source);
		const byMedia = new Map<string, { source: TakeCycleCaptureDraft['sources'][number]; spans: number[]; start: number; end: number }>();
		let firstSpan = 0;
		for (const [index, pass] of plan.passes.entries()) {
			while (firstSpan < draft.lane.captureSpans.length && draft.lane.captureSpans[firstSpan]!.endSample <= pass.captureStartSample) firstSpan++;
			const spans: number[] = [];
			for (let span = firstSpan; span < draft.lane.captureSpans.length && draft.lane.captureSpans[span]!.startSample < pass.captureEndSample; span++) spans.push(span);
			const mediaId = draft.lane.publications[index]!.mediaId, source = sourceById.get(mediaId);
			if (source && !byMedia.has(mediaId)) byMedia.set(mediaId, { source, spans, start: pass.captureStartSample, end: pass.captureEndSample });
		}
		return { draft, session, byMedia };
	}
	async function context(value: TakeCycleCaptureDraft) {
		if (!isOwned(value) || !repository.openReadSession) return prepare(value);
		let result = prepared.get(value);
		if (!result) { result = prepare(value); prepared.set(value, result); }
		try { return await result; } catch (error) { prepared.delete(value); throw error; }
	}
	async function* read(value: TakeCycleCaptureDraft, mediaId: string, signal?: AbortSignal): AsyncGenerator<readonly Float32Array[]> {
		const { draft, session, byMedia } = await context(value);
		await session.assertCurrent();
		const pass = byMedia.get(mediaId);
		if (!pass) throw new ReferenceError(`Unknown take cycle capture media: ${mediaId}.`);
		const { source } = pass;
		const buffers = Array.from({ length: source.channelCount }, () => new Float32Array(source.chunkFrames));
		let buffered = 0, written = 0;
		for (const index of pass.spans) {
			throwIfAborted(signal);
			const span = draft.lane.captureSpans[index]!, chunk = await session.chunk(index);
			throwIfAborted(signal);
			let offset = Math.max(span.startSample, pass.start) - span.startSample;
			let remaining = Math.min(span.endSample, pass.end) - Math.max(span.startSample, pass.start);
			while (remaining > 0) {
				const count = Math.min(remaining, source.chunkFrames - buffered);
				for (let channel = 0; channel < source.channelCount; channel++) buffers[channel]!.set(chunk.channels[channel]!.subarray(offset, offset + count), buffered);
				buffered += count; written += count; offset += count; remaining -= count;
				if (buffered === source.chunkFrames) { yield Object.freeze(buffers.map(channel => channel.slice())); buffered = 0; }
			}
		}
		if (buffered) yield Object.freeze(buffers.map(channel => channel.slice(0, buffered)));
		if (written !== source.frameCount) throw new Error('Live capture pass is truncated.');
	}
	return (draft: TakeCycleCaptureDraft, mediaId: string, { signal }: { readonly signal?: AbortSignal } = {}) =>
		read(draft, stableId(mediaId, 'take cycle mediaId'), signal);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Take cycle capture aborted.', 'AbortError');
}
