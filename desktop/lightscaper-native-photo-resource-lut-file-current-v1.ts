/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseCubeLutV1, VIDEO_COLOR_LIMITS_V1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { captureLightscaperNativePhotoResourceBodyCurrentV1, type LightscaperNativePhotoResourceBodyCurrentV1 } from './lightscaper-native-photo-resource-body-current-v1.ts';

const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, BLOB_READ = Blob.prototype.arrayBuffer;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;

/** Native immutable Blob custody ignores borrowed file methods. The owner
 * joins this actual read, authenticates the resulting packet and then installs. */
export async function readLightscaperNativePhotoLutFileCurrentV1(file: Blob, signal?: AbortSignal): Promise<LightscaperNativePhotoResourceBodyCurrentV1<'lut'>> {
	check(signal); const size = Number(Reflect.apply(BLOB_SIZE, file, []));
	if (size < 1 || size > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) throw new RangeError('Native LUT file exceeds its fixed byte bound.');
	const buffer = await (Reflect.apply(BLOB_READ, file, []) as Promise<ArrayBuffer>), bytes = new Uint8Array(buffer);
	try {
		check(signal);
		if (Reflect.apply(BUFFER_SIZE, buffer, []) !== size) throw new RangeError('Native LUT file body differs from its admitted size.');
		if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TypeError('Native LUT UTF8 must not start with a BOM.');
		const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
		if (parsed.byteLength !== size) throw new TypeError('Native LUT file requires its exact UTF8 representation.');
		check(signal);
		return captureLightscaperNativePhotoResourceBodyCurrentV1('lut', { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
			byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax }, bytes);
	} finally { Reflect.apply(FILL, bytes, [0]); }
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
