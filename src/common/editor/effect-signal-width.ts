/* SPDX-License-Identifier: AGPL-3.0-only */

interface WidthEffect {
	readonly type?: unknown;
	readonly enabled?: boolean;
	readonly bypassed?: boolean;
	readonly params?: Readonly<Record<string, unknown>>;
}
interface WidthOwner { readonly effectsActive?: boolean; readonly effects?: readonly WidthEffect[] }
interface ClipWidthProject {
	readonly sources?: readonly Readonly<{ id?: unknown; channelCount?: unknown }>[];
	readonly clips?: readonly (Readonly<{ id?: unknown; sourceId?: unknown }> & WidthOwner)[];
	readonly tracks?: readonly Readonly<{ id?: unknown; clipIds?: readonly unknown[] }>[];
}

/** The built-in mono convolver emits its authored stereo impulse, even at a partial wet mix. */
export function effectSignalChannelCount(effect: WidthEffect, input: number): number {
	const mix = Number(effect.params?.mix ?? .25);
	return effect.enabled !== false && effect.bypassed !== true && ['reverb', 'convolver'].includes(String(effect.type)) && mix > 0
		? Math.max(input, 2) : input;
}

export function rackSignalChannelCount(owner: WidthOwner | undefined, input: number): number {
	return owner?.effectsActive === false ? input : (owner?.effects ?? []).reduce((width, effect) => effectSignalChannelCount(effect, width), input);
}

/** Processor capacity follows clip output; persisted route maps retain their source-layout meaning. */
export function clipRackTrackInputChannelCounts(project: ClipWidthProject, declared: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
	const sources = new Map((project.sources ?? []).map(source => [source.id, Number(source.channelCount)]));
	const clips = new Map((project.clips ?? []).map(clip => [clip.id, clip]));
	const widths = new Map(declared);
	for (const [index, track] of (project.tracks ?? []).entries()) {
		const id = String(track.id ?? index), fallback = declared.get(id) ?? 2;
		let width = 0;
		for (const clipId of track.clipIds ?? []) {
			const clip = clips.get(clipId);
			if (!clip) continue;
			const source = sources.get(clip.sourceId);
			width = Math.max(width, rackSignalChannelCount(clip, source && Number.isFinite(source) ? source : fallback));
		}
		widths.set(id, width || fallback);
	}
	return widths;
}
