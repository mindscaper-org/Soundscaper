/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_NATIVE_TARGETS, type MotionNativeTarget } from '../scripts/lib/motionscaper-native-source.ts';

/** The own Motion release targets are the authority; host names are never receipt targets. */
export function motionQualificationTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): MotionNativeTarget {
	const prefix = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform;
	const target = `${prefix}-${arch}`;
	if (!(MOTION_NATIVE_TARGETS as readonly string[]).includes(target)) throw new Error(`Unsupported Motion qualification target ${target}.`);
	return target as MotionNativeTarget;
}

export function requireMotionQualificationHost(target: string, env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform, arch: string = process.arch): void {
	if (motionQualificationTarget(platform, arch) !== target) throw new Error('Qualification target differs from the actual native host.');
	if (platform === 'linux' && !/^:\d+$/u.test(env.DISPLAY ?? '')) {
		throw new Error('Linux qualification requires an X11 display.');
	}
}
