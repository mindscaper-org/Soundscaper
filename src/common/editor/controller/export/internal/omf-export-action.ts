/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveDeliveredProject } from '../interchange-export-action.ts';
import type { ExportActionGroupRuntime } from '../export-action-group.ts';
import type { DeliveryReportState } from '../export-state.ts';
import { createInterchangeVisibility } from '../../../interchange-track-visibility.ts';
import { encodeWav } from '../../../wav.js';

export interface OmfExportStore {
	readSourceChunks?(sourceId: string): AsyncIterable<readonly Float32Array[] | Readonly<{ channels: readonly Float32Array[] }>>;
}

const MAXIMUM_PCM_BYTES = 256 * 1024 * 1024;

/** Embed source WAVs in OMF so a downloaded edit never points at private storage keys. */
export async function exportProjectOmf(runtime: ExportActionGroupRuntime & Readonly<{ state: DeliveryReportState }>, sequenceId?: string) {
	const original = runtime.getProject?.();
	if (!original) return null;
	const project = resolveDeliveredProject({ ...runtime, getProject: () => original, sequenceId });
	if (!project) return null;
	const read = runtime.store?.readSourceChunks;
	const sources = Array.isArray(project.sources) ? project.sources as Readonly<Record<string, unknown>>[] : [];
	const clips = Array.isArray(project.clips) ? project.clips as Readonly<Record<string, unknown>>[] : [];
	const tracks = Array.isArray(project.tracks) ? project.tracks as Readonly<Record<string, unknown>>[] : [];
	const visibility = createInterchangeVisibility(tracks, project);
	const clipIds = new Set(tracks.filter(track => track.type === 'audio' && visibility.contributes(track))
		.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	const sourceIds = new Set(clips.filter(clip => clip.kind === 'audio' && clipIds.has(String(clip.id))).map(clip => String(clip.sourceId)));
	const selected = sources.filter(source => sourceIds.has(String(source.id)) && Number(source.channelCount) <= 2);
	if (selected.length && !read) throw new Error('OMF export requires stored source audio.');
	const total = selected.reduce((sum, source) => sum + Number(source.frameCount) * Number(source.channelCount) * 4, 0);
	if (!Number.isSafeInteger(total) || total > MAXIMUM_PCM_BYTES) throw new RangeError('Embedded OMF audio exceeds the 256 MiB PCM limit.');
	const media = new Map<string, Uint8Array>();
	for (const source of selected) {
		const frames = Number(source.frameCount), count = Number(source.channelCount), rate = Number(source.sampleRate);
		if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(count) || count < 1 || count > 64
			|| !Number.isSafeInteger(rate) || rate < 1) throw new TypeError('An OMF source has invalid audio metadata.');
		const channels = Array.from({ length: count }, () => new Float32Array(frames));
		let offset = 0;
		for await (const packet of read!.call(runtime.store, String(source.storageKey ?? source.id))) {
			const chunk = 'channels' in packet ? packet.channels : packet;
			const length = chunk[0]?.length ?? 0;
			if (chunk.length !== count || length < 1 || offset + length > frames || chunk.some(channel => channel.length !== length)) {
				throw new Error('An OMF source audio packet does not match its metadata.');
			}
			for (let channel = 0; channel < count; channel++) channels[channel]!.set(chunk[channel]!, offset);
			offset += length;
		}
		if (offset !== frames) throw new Error('OMF source audio ended before its declared duration.');
		media.set(String(source.id), encodeWav(channels, { sampleRate: rate, bitDepth: 24 }) as Uint8Array);
		if (runtime.getProject?.() !== original) throw new Error('The project changed during OMF export.');
	}
	const { createOmfExport } = await import('../../../omf-export.ts');
	if (runtime.getProject?.() !== original) throw new Error('The project changed during OMF export.');
	const result = createOmfExport({ project, sequenceId, media });
	const delivered = result;
	runtime.state.deliveryReport = delivered.report;
	runtime.publishDocumentSnapshot?.();
	if (runtime.fileService?.saveFile) await runtime.fileService.saveFile({ purpose: 'interchange', suggestedName: result.fileName,
		mimeType: result.mimeType, blob: new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }) });
	return delivered;
}
