/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { normalizeDesktopAudioCodecCapabilityResult } from '../../../../desktop/desktop-audio-codec-capability-contract.ts';
import { DESKTOP_AUDIO_CODEC_FORMATS } from '../../../../desktop/desktop-audio-codec-operation-contract.ts';
import { createExportFormatAvailability } from '../controller/export/export-format-availability.ts';
import { createDesktopExportCodecQuery } from './desktop-export-codec-model.ts';
import type { DesktopVideoExportFileService } from '../desktop-video-export-capability.ts';

interface FileService extends DesktopVideoExportFileService {
	readonly getDesktopAudioCodecCapabilities?: (query: unknown) => unknown | Promise<unknown>;
	readonly getExternalFfmpegStatus?: () => unknown | Promise<unknown>;
	readonly installExternalFfmpeg?: () => unknown | Promise<unknown>;
}

type Settings = Parameters<typeof createDesktopExportCodecQuery>[0];
const COMPRESSED = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);

/** React adapter; the export controller owns async selection and installation custody. */
export function useDesktopExportAvailability(
	fileService: FileService | undefined, isOpen: boolean, owner: object,
	settings: Settings, projectChannelCount: number,
) {
	const format = String(settings.format);
	const desktop = fileService?.isDesktop === true;
	const store = useMemo(() => createExportFormatAvailability({
		readFfmpegStatus: () => fileService?.getExternalFfmpegStatus?.(),
		...(fileService?.installExternalFfmpeg ? { installFfmpeg: () => fileService.installExternalFfmpeg!() } : {}),
	}), [fileService]);
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const query = useMemo(() => {
		if (!desktop || !COMPRESSED.has(format)) return null;
		try {
			const batch = createDesktopExportCodecQuery(settings, projectChannelCount);
			return { ...batch, operations: batch.operations.filter(tuple => tuple.format === format) };
		} catch (error) { return error instanceof Error ? error : new Error(String(error)); }
	}, [desktop, format, projectChannelCount, settings.sampleRate, settings.channelMapping, settings.channelMatrix,
		settings.binaural, settings.sampleFormat, settings.compressionLevel, settings.quality, settings.bitRate,
		settings.bitRateMode, settings.averageBitRate, settings.vbrQuality, settings.bitRatePreset, settings.vbrMode]);
	const selection = useMemo(() => ({ owner, query, format }), [owner, query, format]);
	const needsCheck = desktop && (COMPRESSED.has(format) || format.startsWith('video-') || format === 'custom-ffmpeg');
	useEffect(() => {
		if (!isOpen || !needsCheck) { store.reset(); return undefined; }
		void store.check(selection, async () => {
			if (query instanceof Error) return { available: false, reasonCode: 'unsupported-settings', cause: query.message };
			if (format === 'custom-ffmpeg') return { available: false, reasonCode: 'custom-unsupported' };
			if (format.startsWith('video-')) {
				const { resolveDesktopRendererVideoExportCapabilities } = await import('../platform-video-delivery-encoder.ts');
				const capabilities = await resolveDesktopRendererVideoExportCapabilities(fileService!);
				const entry = capabilities.formats[format === 'video-mp4' ? 'mp4' : 'webm'];
				return { available: entry.available, requiresFfmpeg: true, cause: entry.reason ?? undefined };
			}
			if (!query || !fileService?.getDesktopAudioCodecCapabilities) throw new Error('The desktop audio codec capability service is unavailable.');
			const raw = await fileService.getDesktopAudioCodecCapabilities(query);
			const entry = normalizeDesktopAudioCodecCapabilityResult(raw, query).capabilities[0]!;
			return { available: entry.available, reasonCode: entry.reason,
				requiresFfmpeg: entry.reason !== 'unsupported-settings', missingCapabilities: entry.missingCapabilities };
		});
		return () => { store.reset(); };
	}, [fileService, format, isOpen, needsCheck, query, selection, store]);
	useEffect(() => () => store.dispose(), [store]);
	const current = state.owner === selection;
	return {
		available: !needsCheck || (current && state.available),
		problem: current ? state.problem : null,
		installing: current && state.installing,
		query: query instanceof Error ? null : query,
		dismiss: store.dismiss,
		install: store.install,
		retry: store.retry,
	};
}
