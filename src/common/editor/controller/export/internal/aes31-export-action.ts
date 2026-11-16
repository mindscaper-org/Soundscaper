/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAdlExport, type AdlExportMedia } from '../../../aes31-export.ts';
import { writeAdlPackage, type AdlPackageFile } from '../../../aes31-package.ts';
import { createWavHeader, createWavStreamEncoder, inspectWavLayout } from '../../../wav.js';
import { resolveDeliveredProject } from '../interchange-export-action.ts';
import type { ExportActionGroupRuntime } from '../export-action-group.ts';


/** Narrow destination capability supplied by the file service, independent of document coordination. */
export interface AdlExportFileService {
	prepareSave?(request: Readonly<{ purpose: 'interchange'; suggestedName: string; mimeType: string;
		types: readonly Readonly<{ description: string; accept: Readonly<Record<string, readonly string[]>> }>[];
		useFileSystemAccess: boolean; signal: AbortSignal;
	}>): Promise<
		| Readonly<{ mode: 'cancelled' }>
		| Readonly<{ mode: 'blob'; target: unknown }>
		| Readonly<{ mode: 'stream'; createWritable(maximumBytes: number): Promise<WritableStream<Uint8Array>>;
			commit(): Promise<Readonly<Record<string, unknown>>>; abort(reason?: unknown): Promise<void> }>
	>;
}

export async function exportProjectAdl(runtime: ExportActionGroupRuntime, options: Readonly<{ sequenceId?: string; signal?: AbortSignal }> = {}) {
	const original = runtime.getProject?.();
	if (!original) return null;
	const project = resolveDeliveredProject({ ...runtime, getProject: () => original, sequenceId: options.sequenceId });
	if (!project) return null;
	const result = createAdlExport({ project, sequenceId: options.sequenceId });
	const signal = options.signal ?? new AbortController().signal;
	const assertCurrent = () => {
		signal.throwIfAborted();
		if (runtime.getProject?.() !== original || runtime.state.disposed) throw new DOMException('The ADL export project changed.', 'AbortError');
	};
	assertCurrent();
	if (result.media.length && !runtime.store?.readSourceChunks) throw new Error('ADL export requires stored source audio.');
	runtime.state.deliveryReport = result.report;
	runtime.publishDocumentSnapshot?.();
	const fileName = `${result.fileName}.zip`;
	const prepared = await runtime.fileService?.prepareSave?.({ purpose: 'interchange', suggestedName: fileName,
		mimeType: 'application/zip', types: [{ description: 'AES31 ADL with audio (ZIP)', accept: { 'application/zip': ['.zip'] } }],
		useFileSystemAccess: true, signal });
	if (prepared?.mode === 'cancelled') return null;
	try {
		assertCurrent();
		const sources = new Map((Array.isArray(project.sources) ? project.sources as Readonly<Record<string, unknown>>[] : []).map(source => [String(source.id), source]));
		const maximumBytes = result.media.reduce((sum, source) => sum + inspectWavLayout(wavOptions(source)).byteLength + 1024,
			new TextEncoder().encode(result.text).byteLength + 1024 * 1024);
		if (!Number.isSafeInteger(maximumBytes)) throw new RangeError('ADL package exceeds its supported byte count.');
		async function* files(): AsyncGenerator<AdlPackageFile> {
			for (const media of result.media) {
				assertCurrent();
				const source = sources.get(media.sourceId)!;
				const chunks = runtime.store!.readSourceChunks!.call(runtime.store, String(source.storageKey ?? source.id), { signal });
				yield { path: media.path, stream: pcmStream(chunks, media, assertCurrent) };
			}
		}
		if (prepared?.mode === 'stream') {
			const writable = await prepared.createWritable(maximumBytes);
			await writeAdlPackage(result, files(), writable, signal);
			assertCurrent();
			const saved = await prepared.commit();
			if (saved.cancelled) return null;
		} else {
			if (maximumBytes > 256 * 1024 * 1024) throw new RangeError('Download-only ADL packages are limited to 256 MiB; choose a streaming save destination.');
			const blob = await writeAdlPackage(result, files(), undefined, signal);
			assertCurrent();
			if (!blob) throw new Error('ADL package writer returned no bytes.');
			const saved = await runtime.fileService?.saveFile?.({ purpose: 'interchange', suggestedName: fileName, mimeType: 'application/zip', blob,
				target: prepared?.target, useFileSystemAccess: false, signal });
			if (saved && typeof saved === 'object' && 'cancelled' in saved && saved.cancelled === true) return null;
		}
		return { ...result, fileName };
	} catch (error) {
		if (prepared?.mode === 'stream') await prepared.abort(error);
		throw error;
	}
}

function wavOptions(media: AdlExportMedia) {
	return { totalFrames: media.frameCount, channelCount: media.channelCount, sampleRate: media.sampleRate, bitDepth: 24 as const,
		bext: { description: 'AES31 source audio', originator: 'Soundscaper', originatorReference: media.originatorReference, timeReference: '0' } };
}

function pcmStream(chunks: AsyncIterable<readonly Float32Array[] | Readonly<{ channels: readonly Float32Array[] }>>,
	media: AdlExportMedia, assertCurrent: () => void): ReadableStream<Uint8Array> {
	const iterator = encode()[Symbol.asyncIterator]();
	return new ReadableStream({
		async pull(controller) {
			try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
			catch (error) { controller.error(error); }
		},
		async cancel() { await iterator.return?.(undefined); },
	});
	async function* encode(): AsyncGenerator<Uint8Array> {
		const options = wavOptions(media), encoder = createWavStreamEncoder({ ...options, collect: false });
		yield createWavHeader(options);
		let frames = 0;
		for await (const packet of chunks) {
			assertCurrent();
			const channels = 'channels' in packet ? packet.channels : packet;
			const count = channels[0]?.length ?? 0;
			if (channels.length !== media.channelCount || count < 1 || channels.some(channel => channel.length !== count) || frames + count > media.frameCount) {
				throw new RangeError('ADL source PCM disagrees with its metadata.');
			}
			for (let offset = 0; offset < count; offset += 65_536) {
				assertCurrent(); yield encoder.write(channels.map(channel => channel.subarray(offset, offset + 65_536)));
			}
			frames += count;
		}
		assertCurrent();
		if (frames !== media.frameCount) throw new Error('ADL source audio ended before its declared duration.');
		encoder.finalize();
	}
}
