/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 as CHANNELS } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import { readDesktopPhotoSessionResponseCurrentV1 as response } from '../src/lightscaper/desktop-photo-session-response-current-v1.ts';
import type { LightscaperPreloadIpcCurrentV1 as Ipc } from './lightscaper-preload-bridge-current-v1.ts';

/** The matched restore lane exposes only four fixed native archive operations. */
export function createLightscaperPreloadRestoreCurrentV1(ipc: Ipc): Readonly<{ invoke(channel: string, payload: unknown): Promise<unknown> }> {
	const allowed = new Set<string>(Object.values(CHANNELS));
	return Object.freeze({
		invoke(channel: string, payload: unknown): Promise<unknown> {
			if (!allowed.has(channel)) return Promise.reject(new TypeError('Unsupported Lightscaper restore channel.'));
			try { return ipc.invoke(channel, payload).then(response); }
			catch (error) { return Promise.reject(error); }
		},
	});
}
