/* SPDX-License-Identifier: AGPL-3.0-only */

interface TimelineClip { readonly id: string; readonly timelineStartFrame: number; readonly durationFrames: number }
interface Identified { readonly id: string }

/** One captured project generation; visibility and per-frame presentation remain dynamic. */
export function createVideoTimelineIndex<Clip extends TimelineClip, Source extends Identified, Track>(
	project: { readonly clips?: readonly Clip[]; readonly sources?: readonly Source[]; readonly tracks?: readonly Track[] },
	prepareTrack: (track: Track, clips: ReadonlyMap<string, Clip>) => readonly Clip[],
) {
	const clipById = new Map((project.clips ?? []).map(clip => [clip.id, clip]));
	const sourceById = new Map((project.sources ?? []).map(source => [source.id, source]));
	const tracks = Array.isArray(project.tracks) ? project.tracks : [];
	const byTrack = new Map<Track, readonly Clip[]>();
	function ordered(track: Track): readonly Clip[] {
		let clips = byTrack.get(track);
		if (!clips) { clips = prepareTrack(track, clipById); byTrack.set(track, clips); }
		return clips;
	}
	return {
		clipById, sourceById, tracks, ordered,
		active(track: Track, frame: number): Clip[] {
			const clips = ordered(track);
			let low = 0, high = clips.length;
			while (low < high) {
				const middle = Math.floor((low + high) / 2);
				if (clips[middle]!.timelineStartFrame <= frame) low = middle + 1; else high = middle;
			}
			const active: Clip[] = [];
			// Admitted composition has at most two overlapping clips and strictly
			// increasing ends, so only the latest two starts can still be active.
			for (let index = Math.max(0, low - 2); index < low; index++) {
				const clip = clips[index]!;
				if (frame < clip.timelineStartFrame + clip.durationFrames) active.push(clip);
			}
			return active;
		},
	};
}
