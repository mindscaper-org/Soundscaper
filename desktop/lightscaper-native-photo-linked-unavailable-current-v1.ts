/* SPDX-License-Identifier: AGPL-3.0-only */
export type LightscaperNativePhotoLinkedUnavailableCurrentV1 = 'grant-missing' | 'grant-revoked' | 'root-missing' | 'file-missing';
const witnesses = new WeakMap<object, LightscaperNativePhotoLinkedUnavailableCurrentV1>();
/** Only actual owning grant/FS admission sites call this constructor. No value
 * shape, error code or diagnostic text can manufacture the private witness. */
export function createLightscaperNativePhotoLinkedUnavailableCurrentV1(reason: LightscaperNativePhotoLinkedUnavailableCurrentV1): Error {
	const error = new Error('The linked Original is unavailable.'); witnesses.set(error, reason); return error;
}
export function readLightscaperNativePhotoLinkedUnavailableCurrentV1(value: unknown): LightscaperNativePhotoLinkedUnavailableCurrentV1 | null {
	return value !== null && typeof value === 'object' ? witnesses.get(value) ?? null : null;
}
