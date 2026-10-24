/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';
import type { WavPackImportGroupDecoder } from '../../../browser-streamed-wavpack-import.ts';
import type { createIncrementalPcmImporter } from './incremental-wav-import-service.ts';
import type { FileSizeWarningConfirmation } from '../../shared/file-size-warning.ts';
import { scanEncodedAudioMarkers } from '../../../encoded-audio-marker-scan.ts';

export async function importStreamedAudioFile(
	file: Blob,
	options: Readonly<{ signal?: AbortSignal; confirmFileSizeWarning?: FileSizeWarningConfirmation; rescueMarkers?: boolean }>,
	codec: WavPackImportGroupDecoder,
	metadata: unknown,
	importPcm: ReturnType<typeof createIncrementalPcmImporter>,
	assertCurrent: () => void,
): Promise<unknown> {
	const { prepareStreamedAudioImport } = await import('../../../browser-streamed-audio-import.ts');
	const markerScan = options.rescueMarkers ? await scanEncodedAudioMarkers(file, options.signal) : null;
	assertCurrent();
	const desktop = isDesktopMainAudioCodecRuntime(codec);
	const prepared = await prepareStreamedAudioImport(file, {
		signal: options.signal, reviewedFallback: !desktop, desktop, desktopCodec: desktop ? codec : undefined,
		confirmFileSizeWarning: options.confirmFileSizeWarning, assertCurrent,
	});
	try {
		const sourceMetadata = markerScan?.metadataWarnings?.length && metadata && typeof metadata === 'object'
			? { ...metadata, warnings: [...metadataWarnings(metadata), ...markerScan.metadataWarnings] } : metadata;
		return await importPcm(file, { ...prepared.descriptor, stream: prepared.stream, ...(markerScan ? { markers: markerScan.markers } : {}) }, options,
			sourceMetadata, { requireChunkStream: true }, { assertCurrent });
	} finally { prepared.dispose(); }
}

function metadataWarnings(value: object): readonly unknown[] {
	const warnings = (value as Readonly<{ warnings?: unknown }>).warnings;
	return Array.isArray(warnings) ? warnings : [];
}
