/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActionRuntime } from '../action-facade-runtime.ts';

/** Browser and native preferences share one audition broadcast authority. */
export function createAuditionOutputActions(scope: EditorActionRuntime) {
	const publish = async <Result>(pending: Promise<Result>, wait = true): Promise<Result> => {
		const result = await pending;
		const deviceId = scope.state.preferredOutputDeviceId ?? scope.engine.getOutputDeviceState?.().preferredDeviceId ?? '';
		const routed = scope.playbackPreviews?.setOutput(deviceId);
		if (wait) await routed;
		else void routed?.catch(scope.handleError);
		return result;
	};
	return Object.freeze({
		setOutput: (...args: Parameters<typeof scope.setAudioOutputDevice>) => publish(scope.setAudioOutputDevice(...args)),
		// The host must finish publishing inventory before it can attach its new
		// native transport. Waiting for that transport here would deadlock setup.
		setHostInventory: (...args: Parameters<typeof scope.setHostInventory>) => publish(scope.setHostInventory(...args), false),
	});
}
