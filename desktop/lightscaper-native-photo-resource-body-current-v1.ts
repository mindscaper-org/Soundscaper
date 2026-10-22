/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1, VIDEO_COLOR_LIMITS_V1, type VideoCubeLutReferenceV1 } from '../src/common/editor/cube-lut-reference-contract.ts';
import { withCubeLutResourceV1 } from '../src/common/editor/imaging/cube-lut-resource-v1.ts';
import { BRUSH_MASK_RESOURCE_LIMITS_V1, normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1,
	type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';

export type LightscaperNativePhotoResourceFamilyCurrentV1 = 'lut' | 'brush';
export type LightscaperNativePhotoResourceReferenceCurrentV1<Family extends LightscaperNativePhotoResourceFamilyCurrentV1> =
	Family extends 'lut' ? VideoCubeLutReferenceV1 : BrushMaskResourceReferenceV1;
export interface LightscaperNativePhotoResourceBodyCurrentV1<Family extends LightscaperNativePhotoResourceFamilyCurrentV1> {
	readonly family: Family;
	readonly reference: Readonly<LightscaperNativePhotoResourceReferenceCurrentV1<Family>>;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly backing: ArrayBuffer;
}
type Family = LightscaperNativePhotoResourceFamilyCurrentV1;
type Body = LightscaperNativePhotoResourceBodyCurrentV1<Family>;
const packets = new WeakSet<object>(), authenticated = new WeakSet<object>();
const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;
const BRUSH_FIELDS = ['storageKey', 'sha256', 'width', 'height', 'byteLength'];

export function admitLightscaperNativePhotoResourceReferenceCurrentV1<F extends Family>(family: F, value: unknown): Readonly<LightscaperNativePhotoResourceReferenceCurrentV1<F>> {
	let reference: VideoCubeLutReferenceV1 | BrushMaskResourceReferenceV1;
	if (family === 'lut') reference = normalizeVideoCubeLutReferenceV1(value);
	else if (family === 'brush') {
		if (typeof value === 'string') reference = normalizeBrushMaskResourceReferenceV1(value);
		else {
			const input = record(value, 'native brush reference', BRUSH_FIELDS);
			reference = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'native brush reference'));
			for (const key of BRUSH_FIELDS) if (field(input, key, 'native brush reference') !== reference[key as keyof BrushMaskResourceReferenceV1]) {
				throw new TypeError('Native brush reference differs from its canonical key.');
			}
		}
	} else throw new TypeError('Unknown native Photo resource family.');
	return reference as unknown as Readonly<LightscaperNativePhotoResourceReferenceCurrentV1<F>>;
}

/** Copies before any parser yield. The packet is main-private; only a scoped
 * source consumer may borrow its raw view. Every backing has the family bound. */
export function captureLightscaperNativePhotoResourceBodyCurrentV1<F extends Family>(family: F, referenceValue: unknown,
	bytesValue: unknown): LightscaperNativePhotoResourceBodyCurrentV1<F> {
	const reference = admitLightscaperNativePhotoResourceReferenceCurrentV1(family, referenceValue);
	const maximum = family === 'lut' ? VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes : BRUSH_MASK_RESOURCE_LIMITS_V1.maximumBodyBytes;
	if (Reflect.apply(TAG, bytesValue, []) !== 'Uint8Array') throw new TypeError('Native resource bodies require native Uint8Array bytes.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(bytesValue as object, key)) throw new TypeError('Native resource byte geometry may not be shadowed.');
	const buffer = Reflect.apply(BUFFER, bytesValue, []) as ArrayBuffer;
	const size = Number(Reflect.apply(SIZE, buffer, [])), length = Number(Reflect.apply(LENGTH, bytesValue, [])), offset = Number(Reflect.apply(OFFSET, bytesValue, []));
	if (Reflect.apply(RESIZABLE, buffer, []) !== false || length < 1 || length > maximum || size > maximum || offset + length > size
		|| family === 'brush' && (size !== reference.byteLength || length !== size || offset !== 0)) throw new RangeError('Native resource bytes exceed their fixed backing bound.');
	const bytes = new NativeBytes(length); Reflect.apply(SET, bytes, [new NativeBytes(buffer, offset, length)]);
	const packet = Object.freeze({ family, reference, bytes, backing: bytes.buffer }); packets.add(packet); return packet;
}

/** Real shared parser/geometry/digest proof settles outside every SQL write. */
export async function authenticateLightscaperNativePhotoResourceBodyCurrentV1(body: Body, signal?: AbortSignal): Promise<void> {
	assertPacket(body); check(signal);
	if (body.family === 'lut') await withCubeLutResourceV1({ reference: body.reference, bytes: body.bytes, signal }, () => undefined);
	else await withBrushMaskResourceV1({ reference: body.reference, bytes: body.bytes, signal }, () => undefined);
	check(signal); authenticated.add(body);
}

/** Install only a genuine parsed packet whose mutable private backing still
 * matches that parser's digest. This check is synchronous before SQL starts. */
export function assertAuthenticatedLightscaperNativePhotoResourceBodyCurrentV1(body: Body): void {
	assertPacket(body);
	if (!authenticated.has(body)) throw new TypeError('Native resource body has no completed authentication.');
	if (Reflect.apply(BUFFER, body.bytes, []) !== body.backing || Reflect.apply(OFFSET, body.bytes, []) !== 0
		|| Reflect.apply(LENGTH, body.bytes, []) !== body.reference.byteLength || Reflect.apply(SIZE, body.backing, []) !== body.reference.byteLength
		|| createHash('sha256').update(body.bytes).digest('hex') !== body.reference.sha256) throw new TypeError('Authenticated native resource body changed.');
}

export function wipeLightscaperNativePhotoResourceBodyCurrentV1(body: Body): void {
	// Consumers may detach or shadow their borrowed view. Cleanup uses the
	// captured native backing and never reflects the returned view's geometry.
	if (Reflect.apply(SIZE, body.backing, []) > 0) Reflect.apply(FILL, new NativeBytes(body.backing), [0]);
	authenticated.delete(body);
}
function assertPacket(value: unknown): asserts value is Body {
	if (value === null || typeof value !== 'object' || !packets.has(value)) throw new TypeError('Native resource authentication requires its genuine captured packet.');
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
