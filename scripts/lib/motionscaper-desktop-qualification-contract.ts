/* SPDX-License-Identifier: AGPL-3.0-only */

export const MOTION_DESKTOP_QUALIFICATIONS = [
	{ id: 'launch', script: 'motionscaper-launch-native-smoke.mjs', markers: ['MOTIONSCAPER_NATIVE_LAUNCH_QUALIFIED'] },
	{ id: 'scene', script: 'motionscaper-scene-native-smoke.mjs', markers: ['MOTIONSCAPER_NATIVE_SCENE_QUALIFIED'] },
	{ id: 'authored', script: 'motionscaper-authored-native-smoke.mjs', markers: ['MOTIONSCAPER_AUTHORED_NATIVE_QUALIFIED'] },
	{ id: 'successor', script: 'motionscaper-successor-native-smoke.mjs', markers: ['FRAMESCAPER_SUCCESSOR_NATIVE_DELIVERY_QUALIFIED', 'FRAMESCAPER_SUCCESSOR_NATIVE_LINK_QUALIFIED'] },
] as const;

export function motionQualificationReceipts(output: string, markers: readonly string[], revision: string): readonly Readonly<Record<string, unknown>>[] {
	return markers.map(marker => {
		const lines = output.split('\n').filter(line => line.startsWith(`${marker} `));
		if (lines.length !== 1) throw new Error(`Expected exactly one ${marker} receipt.`);
		const value: unknown = JSON.parse(lines[0]!.slice(marker.length + 1));
		if (!value || typeof value !== 'object' || Array.isArray(value) || !('sourceRevision' in value) || value.sourceRevision !== revision) throw new Error('Qualification receipt source revision differs.');
		return { marker, ...value };
	});
}
