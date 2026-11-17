/* SPDX-License-Identifier: AGPL-3.0-only */

import { setNativePluginBypassed } from '../native-plugin-realtime-node.js';
import type { SoundscaperNativePluginHostBridgeV1 } from '../native-plugin-host-contract.ts';
import type { createSerialProjectOperationQueue } from '../controller/shared/serial-project-operation-queue.ts';
import type { createSoundscaperNativePluginProjectBinding } from './soundscaper-native-plugin-project-binding.ts';
import type { createSoundscaperNativeRendererOperationBarrier } from './soundscaper-native-renderer-operation-barrier.ts';
import {
	nativePluginProjectStateKey, projectPluginStates, type SoundscaperNativeProjectOperation,
} from './soundscaper-native-renderer-project-operation.ts';

/** Keep an owned helper and its authenticated state current across rack bypass. */
export function createSoundscaperNativePluginBypassPort(options: Readonly<{
	bridge: Pick<SoundscaperNativePluginHostBridgeV1, 'setNativePluginBypassed'>;
	project: Pick<ReturnType<typeof createSoundscaperNativePluginProjectBinding>, 'admitBypassed' | 'setBypassed'> | null;
	activeStateKeys: Map<string, string>;
	stateOperations: ReturnType<typeof createSerialProjectOperationQueue<SoundscaperNativeProjectOperation>>;
	ownershipOperations: ReturnType<typeof createSoundscaperNativeRendererOperationBarrier>;
	assertRuntimeOpen(): void;
}>) {
	return {
		setNativePluginBypassed: options.ownershipOperations.wrap(options.stateOperations.wrap(async (operation,
			request: Readonly<{ instanceId: string; bypassed: boolean }>) => {
			options.assertRuntimeOpen();
			const bypassed = options.project?.admitBypassed(request.instanceId, request.bypassed) ?? request.bypassed;
			const instance = await options.bridge.setNativePluginBypassed({ ...request, bypassed });
			options.assertRuntimeOpen();
			const update = operation.commit(() => options.project?.setBypassed(request.instanceId, bypassed));
			const state = projectPluginStates(operation.project).find(value => value.instanceId === request.instanceId);
			if (state) options.activeStateKeys.set(request.instanceId, nativePluginProjectStateKey(state, operation.projectId));
			setNativePluginBypassed(request.instanceId, update?.bypassed ?? bypassed, update?.transition?.contextTime);
			return instance;
		})),
	};
}
