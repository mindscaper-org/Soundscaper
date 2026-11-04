/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_REUSABLE_FRAMES = 65_536;
const nativeChannelPrototype = Float32Array.prototype;
const nativeMap = Array.prototype.map;

function ordinaryChannels(channels: readonly Float32Array[]): boolean {
	if (Object.getPrototypeOf(channels) !== Array.prototype || Array.prototype.map !== nativeMap
		|| Object.hasOwn(channels, 'map') || Object.hasOwn(channels, 'constructor')) return false;
	for (let index = 0; index < channels.length; index++) {
		const entry = Object.getOwnPropertyDescriptor(channels, index);
		if (!entry || !Object.hasOwn(entry, 'value')) return false;
		const channel: unknown = entry.value;
		if (!ArrayBuffer.isView(channel) || Object.getPrototypeOf(channel) !== nativeChannelPrototype
			|| Object.hasOwn(channel, 'constructor')) return false;
	}
	return true;
}

/** Private contiguous history, bounded independently of unusually large packets. */
export function createResampleHistoryBuffer(channelCount: number): Readonly<{
	frames(channels: readonly Float32Array[]): number;
	append(previous: readonly Float32Array[], next: readonly Float32Array[]): Float32Array[];
	prune(channels: readonly Float32Array[], dropFrames: number): Float32Array[];
	release(): void;
}> {
	let storage: Float32Array[] = [];
	let current: readonly Float32Array[] | null = null;
	let activeFrames = 0;
	const frames = (channels: readonly Float32Array[]): number => channels === current ? activeFrames : channels[0]!.length;
	return {
		frames,
		append(previous, next) {
			const ordinary = ordinaryChannels(previous) && ordinaryChannels(next);
			const retained = previous === current ? activeFrames : ordinary ? previous[0]!.length : 0;
			const required = ordinary ? retained + next[0]!.length : 0;
			if (!ordinary || required > MAXIMUM_REUSABLE_FRAMES) {
				// A managed capacity may include stale padding; expose only its live prefix.
				const historical = previous === current ? Array.from({ length: channelCount }, (_, channel) =>
					new Float32Array(storage[channel]!.buffer, storage[channel]!.byteOffset, retained)) : previous;
				current = null;
				return historical.map((values, channel) => {
					const combined = new Float32Array(values.length + next[channel]!.length);
					combined.set(values); combined.set(next[channel]!, values.length);
					return combined;
				});
			}
			const reuse = previous === current && (storage[0]?.length ?? 0) >= required;
			if ((storage[0]?.length ?? 0) < required) {
				const capacity = 2 ** Math.ceil(Math.log2(required));
				storage = Array.from({ length: channelCount }, () => new Float32Array(capacity));
			}
			for (let channel = 0; channel < channelCount; channel++) {
				const values = previous[channel]!;
				if (!reuse) storage[channel]!.set(values.length === retained ? values
					: new Float32Array(values.buffer, values.byteOffset, retained));
				storage[channel]!.set(next[channel]!, retained);
			}
			activeFrames = required; current = storage;
			return storage;
		},
		prune(channels, dropFrames) {
			// Borrowed and custom views preserve the original copying/species behavior.
			if (channels !== current) return channels.map(values => Float32Array.prototype.slice.call(
				values, Math.min(values.length, dropFrames),
			) as Float32Array);
			for (const values of storage) values.copyWithin(0, dropFrames, activeFrames);
			activeFrames = Math.max(0, activeFrames - dropFrames);
			return storage;
		},
		release() { storage = []; current = null; activeFrames = 0; },
	};
}
