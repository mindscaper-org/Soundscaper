/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundscaperNativePluginHostBridgeV1 } from '../native-plugin-host-contract.ts';

type NativeVendorUiBridge = Pick<SoundscaperNativePluginHostBridgeV1, 'openNativePluginVendorUi' | 'closeNativePluginVendorUi'>;

/** Keep a helper-owned window attached to the project that opened it. */
export async function openSoundscaperNativePluginVendorUi(
	bridge: NativeVendorUiBridge,
	request: Readonly<{ instanceId: string }>,
	openRuntime: (instanceId: string, windowHandleId: string) => Promise<unknown>,
	assertCurrent: () => void,
) {
	assertCurrent();
	const outcome = await bridge.openNativePluginVendorUi(request);
	if (outcome.status !== 'opened') { assertCurrent(); return outcome; }
	const { windowHandleId } = outcome.window;
	try {
		assertCurrent();
		await openRuntime(request.instanceId, windowHandleId);
		assertCurrent();
		return outcome;
	} catch (error) {
		await bridge.closeNativePluginVendorUi({ instanceId: request.instanceId, windowHandleId }).catch(() => false);
		throw error;
	}
}
