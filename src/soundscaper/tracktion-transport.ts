/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionDesktopBridge, TracktionTransportView } from './tracktion-project-contract.ts';

export async function startTracktionPlayback(
	bridge: TracktionDesktopBridge,
	sessionId: string,
): Promise<TracktionTransportView> {
	let transport = await bridge.request({ kind: 'prepareOutput', sessionId });
	const readyBy = performance.now() + 5000;
	while (!transport.ready && performance.now() < readyBy) {
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
		transport = await bridge.request({ kind: 'transportStatus', sessionId });
	}
	if (!transport.ready) throw new Error('Tracktion could not prepare the project audio for playback.');
	const started = await bridge.request({ kind: 'play', sessionId, frame: transport.frame });
	if (!started.playing) throw new Error('Tracktion could not start playback.');
	return started;
}
