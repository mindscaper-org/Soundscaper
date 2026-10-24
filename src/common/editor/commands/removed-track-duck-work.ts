/* SPDX-License-Identifier: AGPL-3.0-only */

type Data = Record<string, unknown>;
export interface RemovedTrackDuckSlot {
	readonly rack: Data[];
	readonly index: number;
	readonly effect: Data;
	readonly lostControl: boolean;
	readonly controlTrackId: unknown;
}

function dataRecord(value: unknown): value is Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as object | null;
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Reflect.ownKeys(value).every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}

function dataArray(value: unknown): value is unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| ['filter', 'map', 'constructor', Symbol.iterator].some(key => Object.hasOwn(value, key))) return false;
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return true;
}

/** Bucket inert selectors without validating processors before their original turn. */
export function prepareRemovedTrackDuckWork(
	project: unknown,
	removed: ReadonlySet<string>,
): ReadonlyMap<string, readonly RemovedTrackDuckSlot[]> | null {
	if (removed.size < 2) return null;
	if (!dataRecord(project) || !dataRecord(project.master) || !dataArray(project.master.effects)
		|| !dataArray(project.tracks)) return null;
	const tracks: Data[] = [];
	for (const track of project.tracks) {
		if (!dataRecord(track) || typeof track.id !== 'string'
			|| (Array.isArray(track.effects) && !dataArray(track.effects))) return null;
		tracks.push(track);
	}
	const mixer = project.mixer;
	if (mixer != null && !dataRecord(mixer)) return null;
	const groups = mixer?.groups ?? [], sends = mixer?.sends ?? [], edges = mixer?.edges ?? [];
	if (!dataArray(groups) || !dataArray(sends) || !dataArray(edges)) return null;
	const buses: Data[] = [];
	for (const bus of [...groups, ...sends]) {
		if (!dataRecord(bus) || !dataArray(bus.effects)) return null;
		buses.push(bus);
	}
	const racks = [project.master.effects,
		...tracks.filter(track => Array.isArray(track.effects)).map(track => track.effects as unknown[]),
		...buses.map(bus => bus.effects as unknown[])];
	for (const rack of racks) for (const effect of rack) {
		if (!dataRecord(effect)) return null;
		if (effect.type !== 'audacity-auto-duck') continue;
		if (effect.context != null && !dataRecord(effect.context)) return null;
		if (effect.params != null && (!dataRecord(effect.params)
			|| Object.values(effect.params).some(value => value !== null && (typeof value === 'object' || typeof value === 'function')))) return null;
	}
	const surviving = new Set(tracks.map(track => track.id));
	const detectors = new Map<unknown, Data[]>();
	for (const edge of edges) {
		if (!dataRecord(edge) || !dataRecord(edge.destination) || !dataRecord(edge.source)) return null;
		if (edge.destination.kind !== 'effect-sidechain') continue;
		if (edge.source.kind === 'track' && typeof edge.source.id !== 'string') return null;
		const id = edge.destination.effectId;
		const values = detectors.get(id);
		if (values) values.push(edge);
		else detectors.set(id, [edge]);
	}
	const first = removed.values().next().value as string | undefined;
	const work = new Map<string, RemovedTrackDuckSlot[]>();
	if (first === undefined) return work;
	for (const values of racks) {
		const rack = values as Data[];
		for (const [index, effect] of rack.entries()) {
			if (effect.type !== 'audacity-auto-duck') continue;
			const explicit = detectors.get(effect.id) ?? [];
			const hasDetector = explicit.some(edge => edge.enabled !== false
				&& ((edge.source as Data).kind !== 'track' || surviving.has((edge.source as Data).id)));
			const lostControl = explicit.length > 0 && !hasDetector;
			const control = (effect.context as Data | null | undefined)?.controlTrackId;
			const turn = lostControl ? first : typeof control === 'string' && removed.has(control) ? control : null;
			if (turn === null) continue;
			const source = explicit.length === 1 ? explicit[0]!.source as Data : null;
			const slot = { rack, index, effect, lostControl: lostControl || !explicit.length,
				controlTrackId: source?.kind === 'track' ? source.id : null };
			const slots = work.get(turn);
			if (slots) slots.push(slot);
			else work.set(turn, [slot]);
		}
	}
	return work;
}
