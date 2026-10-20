/* SPDX-License-Identifier: AGPL-3.0-only */

import { setRecordingTrackRoute, type RecordingRouting } from '../../../recording-routing.js';

/** Automatic assignments follow preferences. A deliberate global setting action
 * can also adopt the ordinary selected route from an older build; merely loading
 * its mono/stereo width never changes an explicit assignment.
 */
export function preferredRecordingRoutes(
	routing: RecordingRouting,
	preferences: Readonly<{ deviceId: string; channelCount: number; deviceLabel?: string }>,
	followTrackId?: string,
): RecordingRouting {
	let next = routing;
	for (const [trackId, route] of Object.entries(routing.routes)) {
		if (!route.followsPreferences && trackId !== followTrackId) continue;
		const display = preferences.deviceId === 'display';
		if ((display ? route.kind === 'display' : route.kind === 'device' && route.deviceId === preferences.deviceId)
			&& route.channelCount === preferences.channelCount && route.followsPreferences) continue;
		try {
			next = setRecordingTrackRoute(next, { id: trackId, type: 'audio' }, {
				...(display ? { kind: 'display' } : {
					kind: 'device', deviceId: preferences.deviceId, deviceLabel: preferences.deviceLabel ?? '',
				}),
				channelStart: 0, channelCount: preferences.channelCount, followsPreferences: true,
			});
		} catch {
			// A reserved channel on another track wins over an automatic assignment.
		}
	}
	return next;
}
