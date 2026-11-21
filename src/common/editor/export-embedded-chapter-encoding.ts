/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeEmbeddedExportChapters,
	mp3ChapterMilliseconds,
	resolveEmbeddedExportChapters,
	supportsEmbeddedExportChapters,
	type EmbeddedExportChapter,
} from './export-embedded-chapters.ts';
import { scaleSampleFrame } from './timeline-time.ts';
import { readEmbedChapters, readEmbeddedChapterTrack } from './export-chapter-track.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export function assertEmbeddedChapterRequest(format: unknown, options: DataRecord, carriesCues = false): void {
	const enabled = readEmbedChapters(options.embedChapters) ?? (options.embedLabelChapters === true);
	if (!enabled) return;
	if (!supportsEmbeddedExportChapters(format) && !(carriesCues && options.embedChapters === true)) {
		throw new RangeError('Embedded chapters support MP3 and M4A export formats.');
	}
	if (options.mode != null && options.mode !== 'mix') {
		throw new RangeError('Embedded chapters require a single mix export.');
	}
	if (options.masteringSequenceId) {
		throw new RangeError('Embedded label chapters cannot describe a rearranged mastering sequence.');
	}
}

/** Keep the ordinary encoding shape unchanged until chapters are requested. */
export function embeddedChapterEncodingFields(
	format: unknown,
	value: unknown,
	sampleRate: number,
): Readonly<{ embeddedChapters?: readonly EmbeddedExportChapter[] }> {
	if (value === undefined) return {};
	if (!supportsEmbeddedExportChapters(format)) {
		throw new RangeError('Embedded chapters support MP3 and M4A export formats.');
	}
	const embeddedChapters = normalizeEmbeddedExportChapters(value, sampleRate);
	if (format === 'aac-m4a' && (embeddedChapters.length > 255
		|| embeddedChapters.some(({ title }) => new TextEncoder().encode(title).length > 255))) {
		throw new RangeError('M4A chapter metadata supports at most 255 chapters and 255 UTF-8 bytes per title.');
	}
	if (format === 'mp3') for (const chapter of embeddedChapters) mp3ChapterMilliseconds(chapter, sampleRate);
	return Object.freeze({ embeddedChapters });
}

/** Resolve chapter boundaries once, before render-route admission captures the plan. */
export function createEmbeddedChapterEncoding<Encoding extends DataRecord>(
	encoding: Encoding,
	project: unknown,
	options: DataRecord,
	range: Readonly<{ startFrame: number; endFrame: number }>,
	output?: Readonly<{ rangeOutputFrames: number; deliveryOutputFrames: number }>,
	carriesCues = false,
): Encoding {
	if (!(readEmbedChapters(options.embedChapters) ?? (options.embedLabelChapters === true))) return encoding;
	assertEmbeddedChapterRequest(encoding.format, options, carriesCues);
	if (carriesCues) return encoding;
	const sampleRate = Number(encoding.sampleRate);
	const track = options.embedChapters === true ? readEmbeddedChapterTrack(options.embeddedChapterTrack) : undefined;
	const chapters = resolveEmbeddedExportChapters(project, range, sampleRate, { ...output, track });
	if (chapters.length === 0) throw new RangeError(track === 'markers'
		? 'No markers occur in the exported range.' : 'No labels occur in the exported range.');
	if (encoding.format === 'aac-m4a') {
		const projectRate = Number(project && typeof project === 'object' && 'sampleRate' in project ? project.sampleRate : NaN);
		const end = output?.deliveryOutputFrames ?? output?.rangeOutputFrames
			?? scaleSampleFrame(range.endFrame - range.startFrame, projectRate, sampleRate, 'point');
		if (chapters.some((chapter, index) => chapter.endFrame !== (chapters[index + 1]?.startFrame ?? end))) {
			throw new RangeError('M4A chapter metadata cannot preserve independent chapter ends. Export MP3 or use contiguous chapters ending at the audio end.');
		}
	}
	return Object.freeze({
		...encoding,
		...embeddedChapterEncodingFields(encoding.format, chapters, sampleRate),
	});
}
