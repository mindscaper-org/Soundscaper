/* SPDX-License-Identifier: AGPL-3.0-only */

import { adaptNativeAudioInventory, type NativeAudioInventory } from '../controller/recording/native-audio-inventory.ts';
import type { SoundscaperNativeServicesBridge } from './soundscaper-native-services-bridge.ts';

/** Retains the older bridge's inventory projection for callers without a selected host. */
export function createSoundscaperNativeRendererAudioInventory(options: Readonly<{
	bridge: SoundscaperNativeServicesBridge;
	publish?: (inventory: NativeAudioInventory) => Promise<unknown>;
	closeSessions(): Promise<void>;
}>) {
	const inventories = new Map<string, NativeAudioInventory>();
	async function publish(): Promise<void> {
		if (!options.publish) return;
		const values = [...inventories.values()].sort((left, right) => left.backend < right.backend ? -1 : left.backend > right.backend ? 1 : 0);
		await options.publish(Object.freeze({ backend: 'native', status: 'ready', detail: '',
			inputs: Object.freeze(values.flatMap((inventory) => inventory.inputs)),
			outputs: Object.freeze(values.flatMap((inventory) => inventory.outputs)),
			rejected: Object.freeze(values.flatMap((inventory) => inventory.rejected)),
		}));
	}
	return Object.freeze({
		async describeNativeAudioBackend(request: Readonly<{ backend: string }>) {
			const outcome = await options.bridge.describeNativeAudioBackend(request);
			if (outcome.status === 'described') {
				const inventory = adaptNativeAudioInventory(outcome.inventory);
				inventories.set(inventory.backend, inventory);
			} else inventories.delete(request.backend);
			await publish();
			return outcome;
		},
		async setNativeAudioHelperEnabled(enabled: boolean) {
			try { return await options.bridge.setNativeAudioHelperEnabled(enabled); }
			finally { if (!enabled) {
				inventories.clear();
				await Promise.all([options.closeSessions(), publish()]);
			} }
		},
	});
}
