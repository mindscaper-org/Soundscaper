/* SPDX-License-Identifier: AGPL-3.0-only */
import type { XmlElement } from './dawproject-xml.ts';

export interface ArdourAudioView {
	readonly path: string;
	readonly channelIndices: readonly number[];
	readonly gain: number;
}

/** File identity and channel gain are independent in Ardour's source records. */
export function readArdourAudioViews(region: XmlElement, sources: ReadonlyMap<string, XmlElement>): readonly ArdourAudioView[] {
	const refs = Object.entries(region.attributes).filter(([key]) => /^source-\d+$/u.test(key))
		.sort(([a], [b]) => Number(a.slice(7)) - Number(b.slice(7))).map(([, value]) => value);
	if (!refs.length) throw new ReferenceError('Ardour audio region has no source.');
	const nodes = refs.map(ref => {
		const source = sources.get(ref);
		if (!source || source.attributes.type === 'midi') throw new ReferenceError('Ardour region references an unavailable audio source.');
		return source;
	});
	const paths = nodes.map(sourcePath), distinctPaths = new Set(paths);
	const channels = nodes.map(node => integer(node.attributes.channel ?? '0', 'source channel'));
	if (refs.length > 2 || (region.attributes.channels && integer(region.attributes.channels, 'channel count', 1) !== refs.length)
		|| channels.some((channel, index) => channel !== (distinctPaths.size === 1 ? index : 0))) {
		throw new RangeError('Ardour audio import requires an unremapped mono or stereo channel layout.');
	}
	const gains = nodes.map(node => {
		const text = node.attributes.gain;
		const value = text === undefined ? 1 : Number(text);
		if (text?.trim() === '' || !Number.isFinite(value) || value < 0) throw new RangeError('Ardour source gain must be finite and non-negative.');
		return value;
	});
	return distinctPaths.size > 1 || gains.some(value => value !== gains[0])
		? paths.map((path, index) => ({ path, channelIndices: [channels[index]!], gain: gains[index]! }))
		: [{ path: paths[0]!, channelIndices: channels, gain: gains[0]! }];
}

function sourcePath(source: XmlElement): string {
	const name = source.attributes.name, origin = source.attributes.origin;
	if (!name) throw new SyntaxError('Ardour Source requires name.');
	return origin && /^(?:[\\/]|[a-z]:[\\/])/iu.test(origin) ? origin : name;
}

function integer(value: string | undefined, label: string, minimum = 0): number {
	if (!value || !/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new RangeError(`Ardour ${label} must be a safe integer.`);
	return Number(value);
}
