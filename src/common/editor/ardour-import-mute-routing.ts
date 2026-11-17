/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ArdourGainFactor } from './ardour-import-gain-curves.ts';
import type { TimelineInterchangeAutomation, TimelineInterchangeDocument, TimelineInterchangeStrip } from './timeline-interchange-types.ts';

type MutePoint = 'Main' | 'PreFader' | 'PostFader';
export type ArdourMixStrip = TimelineInterchangeStrip & Readonly<{ mainMuteBus?: NonNullable<TimelineInterchangeDocument['buses']>[number] }>;

/** A pre-fader host tap precedes mute; apply Ardour's independently selected delivery gate. */
export function ardourSendMuteFactor(point: string | undefined, position: 'pre-fader' | 'post-fader', muted: boolean,
	automation: readonly TimelineInterchangeAutomation[], inactive: boolean): readonly ArdourGainFactor[] {
	if (inactive) return [{ gain: 0, points: [] }];
	if (point === undefined) return [];
	if (!affects(point, position === 'pre-fader' ? 'PreFader' : 'PostFader')) return [];
	if (automation.length > 1) throw new RangeError('An Ardour strip has ambiguous mute automation.');
	return [{ gain: muted ? 0 : 1, points: (automation[0]?.points ?? []).map(value => ({ ...value,
		value: value.value === 0 ? 1 : 0, interpolation: 'hold' })) }];
}

/** Separate the main mute from post-fader sends when Ardour explicitly leaves those sends live. */
export function projectArdourMuteRouting(strip: TimelineInterchangeStrip, routeId: string, name: string, point: string | undefined,
	muted: boolean, automation: readonly TimelineInterchangeAutomation[], inactive: boolean, master: boolean): ArdourMixStrip {
	const mainAffected = affects(point, 'Main');
	const mainMute = inactive || mainAffected && muted;
	const mainAutomation = mainAffected && !inactive ? automation : [];
	const separateMain = !master && !inactive && mainAffected && !affects(point, 'PostFader')
		&& (muted || automation.length > 0) && strip.sends?.some(send => send.position === 'post-fader');
	const remaining = strip.automation?.filter(lane => lane.parameter !== 'mute') ?? [];
	if (!separateMain) return { ...strip, mute: mainMute, automation: [...remaining, ...mainAutomation] };
	const id = `ardour-main-mute:${routeId}`;
	return { ...strip, mute: false, automation: remaining, output: id,
		mainMuteBus: { id, name: `${name} (main output)`, channelCount: 2, gain: 1, pan: 0, mute: mainMute,
			automation: mainAutomation, ...(strip.output === undefined ? {} : { output: strip.output }) } };
}

function affects(point: string | undefined, target: MutePoint): boolean {
	if (point === undefined) return target !== 'PreFader';
	if (/^\d+$/u.test(point)) return (Number(point) & { PreFader: 1, PostFader: 2, Main: 8 }[target]) !== 0;
	const points = point.split(',').map(value => value.trim());
	return points.includes(target) || points.includes('AllPoints');
}
