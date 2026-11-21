/* SPDX-License-Identifier: AGPL-3.0-only */

import { readEmbeddedChapterTrack } from './export-chapter-track.ts';
import { supportsEmbeddedExportChapters } from './export-embedded-chapters.ts';
import type { RiffAnnotationExportOptions } from './timeline-annotation-riff-interchange.ts';

type CueSource = Pick<RiffAnnotationExportOptions, 'markerSource' | 'markerTrackId'>;

/** Connect the chapter selector to the file's cue writer, with legacy defaults for unstated requests. */
export function exportChapterCueOptions(
	format: unknown, carriesCues: boolean, options: Readonly<Record<string, unknown>>, preservedRiffMarkers: boolean,
): CueSource {
	const track = readEmbeddedChapterTrack(options.embeddedChapterTrack);
	if (carriesCues && typeof options.embedChapters === 'boolean') {
		if (preservedRiffMarkers) throw new RangeError('BW64 passthrough preserves the original cue chunks.');
		if (!options.embedChapters) return { markerSource: 'none' };
		if (track === 'markers') return { markerSource: 'timeline-annotations' };
		if (track === 'all-label-tracks') return { markerSource: 'all-label-tracks' };
		if (track !== undefined) return { markerSource: 'label-track', markerTrackId: track.slice(6) };
	}
	if (supportsEmbeddedExportChapters(format) && options.embedChapters === true && track === 'markers') {
		// The compressed writer receives these markers in its embedded chapter plan.
		return { markerSource: 'none' };
	}
	return {
		...(options.markerSource == null ? {} : { markerSource: options.markerSource as CueSource['markerSource'] }),
		...(options.markerTrackId == null ? {} : { markerTrackId: options.markerTrackId as string }),
	};
}
