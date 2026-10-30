/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the first eligible serial lane with logarithmic queries and updates. */
export function createSerialLaneAllocator(initialLanes = 0): (start: number, end: number) => number {
	let capacity = 1, count = initialLanes;
	while (capacity < count) capacity *= 2;
	let minimum = new Array<number>(capacity * 2).fill(Infinity);
	for (let lane = 0; lane < count; lane++) minimum[capacity + lane] = 0;
	rebuild();
	return (start, end): number => {
		let lane: number;
		if (minimum[1]! <= start) {
			let node = 1;
			while (node < capacity) node = minimum[node * 2]! <= start ? node * 2 : node * 2 + 1;
			lane = node - capacity;
		} else {
			lane = count++;
			if (lane === capacity) {
				const previous = minimum, previousCapacity = capacity;
				capacity *= 2;
				minimum = new Array<number>(capacity * 2).fill(Infinity);
				for (let index = 0; index < previousCapacity; index++) minimum[capacity + index] = previous[previousCapacity + index]!;
				rebuild();
			}
		}
		let node = capacity + lane;
		minimum[node] = end;
		while (node > 1) {
			node = Math.floor(node / 2);
			minimum[node] = Math.min(minimum[node * 2]!, minimum[node * 2 + 1]!);
		}
		return lane;
	};

	function rebuild(): void {
		for (let node = capacity - 1; node > 0; node--) minimum[node] = Math.min(minimum[node * 2]!, minimum[node * 2 + 1]!);
	}
}
