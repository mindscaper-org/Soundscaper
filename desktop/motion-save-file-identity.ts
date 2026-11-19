/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BigIntStats } from 'node:fs';
import { nativeChildFileIdentityFromStat, type CanonicalNativeChildFileIdentity } from './native-child-file-identity.ts';

export interface MotionSaveFingerprint extends CanonicalNativeChildFileIdentity {
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
}
export type MotionSaveDirectoryIdentity = CanonicalNativeChildFileIdentity;

/** Keep every filesystem identity bit while retaining Node's existing numeric size/time contract. */
export function motionSaveFingerprint(stat: BigIntStats): MotionSaveFingerprint {
	if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Motion file size must be a nonnegative safe integer.');
	return { ...nativeChildFileIdentityFromStat(stat), size: Number(stat.size),
		mtimeMs: milliseconds(stat.mtimeNs), ctimeMs: milliseconds(stat.ctimeNs) };
}
export function sameMotionSaveFile(a: MotionSaveFingerprint | null | undefined, b: MotionSaveFingerprint | null | undefined): boolean {
	return !!a && !!b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
function milliseconds(nanoseconds: bigint): number {
	// Match Node's numeric Stats sec*1000+nsec/1e6, rather than truncated BigIntStats.mtimeMs.
	let seconds = nanoseconds / 1000000000n, fraction = nanoseconds % 1000000000n;
	if (fraction < 0n) { seconds--; fraction += 1000000000n; }
	return Number(seconds) * 1000 + Number(fraction) / 1000000;
}
