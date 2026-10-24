/* SPDX-License-Identifier: AGPL-3.0-only */

export function visits(method: 'find' | 'filter' | 'includes' | 'slice', run: () => void): number {
	const original = Array.prototype[method];
	let count = 0;
	Object.defineProperty(Array.prototype, method, { configurable: true, writable: true,
		value(this: unknown[], ...args: unknown[]) {
			if (method === 'includes' || method === 'slice') count += this.length;
			else {
				const predicate = args[0] as (value: unknown, index: number, array: unknown[]) => unknown;
				args[0] = (value: unknown, index: number, array: unknown[]) => {
					count += 1;
					return Reflect.apply(predicate, args[1], [value, index, array]) as unknown;
				};
			}
			return Reflect.apply(original, this, args) as unknown;
		} });
	try { run(); } finally { Object.defineProperty(Array.prototype, method, { value: original }); }
	return count;
}

export function takeGroup(size = 1, trackId = 'track') {
	return { key: 'group', sourceSequenceId: 'sequence', sourceTrackId: trackId,
		startOffsetFrame: 0, endOffsetFrame: size, laneOrder: ['lane'], lanes: [{ key: 'lane' }],
		takes: [{ key: 'take', laneKey: 'lane', sourceId: 'source', startOffsetFrame: 0, endOffsetFrame: size, sourceStartFrame: 0 }],
		compRegions: Array.from({ length: size }, (_, index) => ({ key: `region-${index}`, takeKey: 'take', startOffsetFrame: index, endOffsetFrame: index + 1 })) };
}

