/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeliveryPresetState, type DeliveryPresetState } from '../../../delivery-preset-store.ts';

export interface DeliveryPresetMutationRepository {
	get(key: string): Promise<unknown>;
	putIfAbsent(key: string, value: unknown): Promise<boolean>;
	replaceIfCurrent(key: string, expected: unknown, replacement: unknown): Promise<boolean>;
}

export interface DeliveryPresetMutation<Result> {
	readonly state: DeliveryPresetState;
	readonly result: Result;
}

/** Replay only the requested edit against the latest collection, never a stale library. */
export async function mutateDeliveryPresetCollection<Result>(
	repository: DeliveryPresetMutationRepository,
	key: string,
	mutate: (current: DeliveryPresetState) => DeliveryPresetMutation<Result>,
): Promise<DeliveryPresetMutation<Result>> {
	for (let attempt = 0; attempt < 16; attempt += 1) {
		const current = await repository.get(key);
		const mutation = mutate(createDeliveryPresetState(current));
		const state = createDeliveryPresetState(mutation.state);
		const committed = current === undefined
			? await repository.putIfAbsent(key, state)
			: await repository.replaceIfCurrent(key, current, state);
		if (committed) return { state, result: mutation.result };
	}
	throw new DOMException('Delivery presets changed in another editor. Retry the edit.', 'InvalidStateError');
}
