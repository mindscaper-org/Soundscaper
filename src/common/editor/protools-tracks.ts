/* SPDX-License-Identifier: AGPL-3.0-only */

import { proToolsChildren, type ProToolsContainer } from './protools-binary.ts';
import type { ProToolsRegion } from './protools-audio.ts';

export interface ProToolsPlacement { readonly regionIndex: number; readonly start: number; readonly fade: boolean }
export interface ProToolsLane {
	readonly index: number;
	readonly name: string;
	readonly channel: number;
	readonly channelCount: number;
	readonly placements: readonly ProToolsPlacement[];
}

export function readProToolsTracks(container: ProToolsContainer, regions: readonly (ProToolsRegion | null)[]): readonly ProToolsLane[] {
	const { reader, blocks } = container;
	const catalog = new Map<number, { name: string; channel: number; channelCount: number }>();
	for (const table of blocks.filter(block => block.kind === 0x1015)) {
		for (const track of proToolsChildren(table, 0x1014)) {
			const name = reader.string(track.offset + 2, track.end);
			const count = reader.uint(name.next + 1, 4, track.end);
			if (!count || count > 64) throw new RangeError('Pro Tools track channel count is unsupported.');
			for (let channel = 0; channel < count; channel++) {
				const index = reader.uint(name.next + 5 + channel * 2, 2, track.end);
				if (catalog.has(index)) throw new SyntaxError('Duplicate Pro Tools audio lane index.');
				catalog.set(index, { name: name.text, channel, channelCount: count });
			}
		}
	}
	const tables = blocks.filter(block => block.kind === 0x1054 || block.kind === 0x1012);
	if (tables.length > 1) throw new SyntaxError('Ambiguous Pro Tools audio placement tables.');
	const table = tables[0];
	if (!table) {
		if (catalog.size) throw new SyntaxError('The Pro Tools audio placement table is unavailable.');
		return [];
	}
	const modern = table.kind === 0x1054;
	const lanes = proToolsChildren(table, modern ? 0x1052 : 0x1011);
	return lanes.map((lane, index) => {
		const name = reader.string(lane.offset + 2, lane.end).text;
		const authored = catalog.get(index);
		if (!authored) throw new ReferenceError('A Pro Tools audio lane is missing from the track catalog.');
		const placements = proToolsChildren(lane, modern ? 0x1050 : 0x100f).flatMap(entry => {
			const fade = modern && entry.offset + 46 < entry.end && reader.uint(entry.offset + 46, 1, entry.end) === 1;
			return proToolsChildren(entry, modern ? 0x104f : 0x100e).map(placement => {
				const regionIndex = reader.uint(placement.offset + 4, 4, placement.end);
				const start = modern ? reader.uint(placement.offset + 9, 5, placement.end) : regions[regionIndex]?.start ?? 0;
				return { regionIndex, start, fade };
			});
		});
		return { index, name: authored.name || name, channel: authored.channel, channelCount: authored.channelCount, placements };
	});
}
