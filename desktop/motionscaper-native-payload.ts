/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertSoundscaperNativeBinaryArchitecture } from '../scripts/lib/soundscaper-native-binary-architecture.mjs';

export const MOTION_NATIVE_PAYLOAD_TARGETS = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const;
export type MotionNativePayloadTarget = typeof MOTION_NATIVE_PAYLOAD_TARGETS[number];
export interface MotionNativePayload {
	readonly path: string; readonly byteLength: number; readonly sha256: string; readonly receiptSha256: string;
}
export interface MotionNativeSigningProof {
	readonly schemaVersion: 1; readonly kind: 'developer-id'; readonly teamId: string;
	readonly original: { readonly byteLength: number; readonly sha256: string; readonly receiptSha256: string };
	readonly signed: { readonly byteLength: number; readonly sha256: string };
}
export interface MotionNativeCompileProvenance {
	readonly target: MotionNativePayloadTarget; readonly byteLength: number; readonly sha256: string; readonly receiptSha256: string;
}
export interface MotionNativePayloadManifest {
	readonly schemaVersion: 1; readonly productId: 'motionscaper'; readonly helperContractVersion: 1;
	readonly carrierVersion: 1; readonly target: MotionNativePayloadTarget; readonly helper: MotionNativePayload | null;
	readonly signing?: MotionNativeSigningProof;
}
export interface MotionNativeExecutable { readonly path: string; readonly manifest: MotionNativePayloadManifest }
export function motionscaperNativePayloadPath(target: MotionNativePayloadTarget): string {
	return `runtime/motionscaper-media-host/motionscaper-media-host${target.startsWith('win-') ? '.exe' : ''}`;
}
export function parseMotionscaperNativePayload(value: unknown): MotionNativePayloadManifest {
	const hasSigning = value !== null && typeof value === 'object' && Object.hasOwn(value, 'signing');
	const input = record(value, ['schemaVersion', 'productId', 'helperContractVersion', 'carrierVersion', 'target', 'helper', ...(hasSigning ? ['signing'] : [])]);
	if (input.schemaVersion !== 1 || input.productId !== 'motionscaper' || input.helperContractVersion !== 1 || input.carrierVersion !== 1) throw new Error('Motionscaper native payload identity is invalid.');
	const target = MOTION_NATIVE_PAYLOAD_TARGETS.find(target => target === input.target);
	if (!target) throw new Error('Motionscaper native payload target is invalid.');
	let helper: MotionNativePayload | null = null;
	if (input.helper !== null) {
		const entry = record(input.helper, ['path', 'byteLength', 'sha256', 'receiptSha256']);
		if (entry.path !== motionscaperNativePayloadPath(target) || typeof entry.byteLength !== 'number'
			|| !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1 || entry.byteLength > 256 * 1024 * 1024) throw new Error('Motionscaper native payload path or length is invalid.');
		helper = { path: entry.path, byteLength: entry.byteLength, sha256: digest(entry.sha256), receiptSha256: digest(entry.receiptSha256) };
	}
	const signing = hasSigning ? parseSigning(input.signing, target, helper) : undefined;
	return Object.freeze({ schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1,
		target, helper: helper && Object.freeze(helper), ...(signing ? { signing } : {}) });
}
/** Release assembly must retain the genuine compile tuple even when codesign changes packaged bytes. */
export function assertMotionscaperNativeCompileProvenance(payloadInput: unknown, expected: MotionNativeCompileProvenance): void {
	const payload = parseMotionscaperNativePayload(payloadInput);
	const original = payload.signing?.original ?? payload.helper;
	if (!payload.helper || !original || payload.target !== expected.target || original.byteLength !== expected.byteLength
		|| original.sha256 !== expected.sha256 || original.receiptSha256 !== expected.receiptSha256) {
		throw new Error('Motionscaper native compile provenance identity changed.');
	}
}
function parseSigning(value: unknown, target: MotionNativePayloadTarget, helper: MotionNativePayload | null): MotionNativeSigningProof {
	const input = record(value, ['schemaVersion', 'kind', 'teamId', 'original', 'signed']);
	if (target !== 'mac-arm64' || !helper || input.schemaVersion !== 1 || input.kind !== 'developer-id'
		|| typeof input.teamId !== 'string' || !/^[A-Z0-9]{10}$/u.test(input.teamId)) throw new Error('Motionscaper native payload signing identity is invalid.');
	const original = record(input.original, ['byteLength', 'sha256', 'receiptSha256']);
	const signed = record(input.signed, ['byteLength', 'sha256']);
	for (const entry of [original, signed]) if (typeof entry.byteLength !== 'number' || !Number.isSafeInteger(entry.byteLength)
		|| entry.byteLength < 1 || entry.byteLength > 256 * 1024 * 1024) throw new Error('Motionscaper native payload signing length is invalid.');
	const originalTuple = { byteLength: original.byteLength as number, sha256: digest(original.sha256), receiptSha256: digest(original.receiptSha256) };
	const signedTuple = { byteLength: signed.byteLength as number, sha256: digest(signed.sha256) };
	if (originalTuple.receiptSha256 !== helper.receiptSha256 || signedTuple.byteLength !== helper.byteLength
		|| signedTuple.sha256 !== helper.sha256) throw new Error('Motionscaper native payload signing derivation differs from its helper.');
	return Object.freeze({ schemaVersion: 1, kind: 'developer-id', teamId: input.teamId,
		original: Object.freeze(originalTuple), signed: Object.freeze(signedTuple) });
}
/** The manifest is in the authenticated app archive; native files remain an exact separate closure. */
export async function loadMotionscaperNativeExecutable(resourcesRoot: string, manifestInput: unknown): Promise<MotionNativeExecutable | null> {
	const manifest = parseMotionscaperNativePayload(manifestInput);
	if (!manifest.helper) return null;
	const root = resolve(resourcesRoot); const path = join(root, manifest.helper.path);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path || before.size !== manifest.helper.byteLength) throw new Error('Motionscaper native payload is not its bounded canonical file.');
	const bytes = await readFile(path); const after = await lstat(path);
	if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs
		|| before.ctimeMs !== after.ctimeMs || before.size !== after.size
		|| createHash('sha256').update(bytes).digest('hex') !== manifest.helper.sha256) throw new Error('Motionscaper native payload digest changed.');
	assertSoundscaperNativeBinaryArchitecture(bytes, manifest.target);
	return Object.freeze({ path, manifest });
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error('Motionscaper native payload fields are not closed.');
	return value as Record<string, unknown>;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new Error('Motionscaper native payload digest is invalid.'); return value;
}
