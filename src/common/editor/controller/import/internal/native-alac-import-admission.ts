/* SPDX-License-Identifier: AGPL-3.0-only */
import { Input, BlobSource, MP4 } from 'mediabunny';
import { readDesktopOriginalM4aMovie } from '../../../desktop-original-m4a-movie.ts';
import { readIsoAudioPresentationEnd } from '../../../iso-audio-presentation-edit.ts';
import { readAlacSampleDescription } from '../../../alac-sample-description.ts';

const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
interface Geometry { readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number; readonly decodeSampleRate: number }

/** ALAC has a native decoder on some maintained platforms, but no incremental decoder. */
export async function nativeAlacImportAdmission(file: Blob, signal?: AbortSignal): Promise<Geometry | null> {
	signal?.throwIfAborted();
	if (file.size > 32 * 1024 ** 2) return null;
	const description = await readDesktopOriginalM4aMovie({ size: file.size, slice: (start, end) => ({ async arrayBuffer() {
		signal?.throwIfAborted(); const bytes = await file.slice(start, end).arrayBuffer(); signal?.throwIfAborted(); return bytes;
	} }) }, 1024 ** 2);
	signal?.throwIfAborted();
	const geometry = description ? readAlacSampleDescription(description) : null;
	if (!geometry) return null;
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	const retire = (): void => input.dispose();
	signal?.addEventListener('abort', retire, { once: true });
	try {
		const tracks = await input.getTracks(); signal?.throwIfAborted();
		if (tracks.length !== 1 || !tracks[0]?.isAudioTrack()) return null;
		const track = tracks[0];
		const [sampleRate, channelCount, origin, duration] = await Promise.all([
			track.getSampleRate(), track.getNumberOfChannels(), track.getFirstTimestamp(), track.computeDuration(),
		]);
		signal?.throwIfAborted();
		if (sampleRate !== geometry.sampleRate || channelCount !== geometry.channelCount || origin !== 0
			|| !Number.isFinite(duration) || duration <= 0) return null;
		const frameCount = Math.round(duration * sampleRate);
		if (!Number.isSafeInteger(frameCount) || frameCount < 1 || Math.abs(frameCount - duration * sampleRate) > .0001
			|| frameCount * channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
		const end = await readIsoAudioPresentationEnd(file, track.id, signal); signal?.throwIfAborted();
		// Leave trimmed/leading-empty presentations on the existing truthful refusal path.
		if (end !== null && Math.abs(end - duration) > .0001 / sampleRate) return null;
		return Object.freeze({ sampleRate, channelCount, frameCount, decodeSampleRate: sampleRate });
	} catch (error) { signal?.throwIfAborted(); throw error;
	} finally { signal?.removeEventListener('abort', retire); input.dispose(); }
}
