/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_NATIVE_TARGETS, type MotionNativeTarget } from './motionscaper-native-source.ts';

/** The reference artifact executes only on one of Motion's five actual native targets. */
export function currentMotionReferenceTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): MotionNativeTarget {
	const target = MOTION_NATIVE_TARGETS.find(value => value === `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform}-${arch}`);
	if (!target) throw new Error('Reference decoder target is unsupported.');
	return target;
}

export function requireMotionReferenceHost(target: MotionNativeTarget, platform: NodeJS.Platform = process.platform, arch: string = process.arch): void {
	const actual = `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform}-${arch}`;
	if (!MOTION_NATIVE_TARGETS.includes(target) || target !== actual) throw new Error('Reference artifact requires its matching native target.');
}

export function motionReferenceDecoderName(target: MotionNativeTarget): string {
	if (!MOTION_NATIVE_TARGETS.includes(target)) throw new Error('Reference decoder target is unsupported.');
	return `motion-reference-decoder${target.startsWith('win-') ? '.exe' : ''}`;
}
