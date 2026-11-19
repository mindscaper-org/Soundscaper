/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { canonicalNativeChildFileIdentity } from './native-child-file-identity.ts';
import type { MotionSaveFingerprint } from './motion-save-file-identity.ts';

interface Journal<Fingerprint, Version extends 1 | 2> {
	readonly format: 'motionscaper-save-publication'; readonly version: Version; readonly transactionId: string; readonly projectId: string;
	readonly phase: 'pending' | 'published' | 'rolled-back'; readonly candidate: Fingerprint; readonly sha256: string;
	readonly previous: Fingerprint | null; readonly backup: Fingerprint | null; readonly previousSha256: string | null;
}
interface LegacyFingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
export type MotionSaveJournal = Journal<MotionSaveFingerprint, 2>;
export interface MotionReadSaveJournal { readonly journal: MotionSaveJournal; readonly checksum: string }
type WireJournal = MotionSaveJournal | Journal<LegacyFingerprint, 1>;
const MAXIMUM_ARCHIVE_BYTES = 64 * 1024 ** 3;
const fingerprintFields = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const;

/** New publications always seal the lossless v2 representation. */
export function encodeMotionSaveJournal(journal: MotionSaveJournal): MotionReadSaveJournal {
	const normalized = normalizeJournal(journal);
	if (normalized.version !== 2) throw new Error('Motion Save journal writes require version 2.');
	return { journal: normalized, checksum: seal(normalized) };
}

/** The original wire checksum remains the compare-and-swap owner after migration. */
export function decodeMotionSaveJournal(value: unknown): MotionReadSaveJournal {
	const envelope = record(value, ['journal', 'checksum']);
	const wire = normalizeJournal(envelope.journal), checksum = digest(envelope.checksum);
	// A v1 seal covers numbers, not their canonical string replacements. Check
	// that exact legacy representation before returning the current runtime form.
	if (checksum !== seal(wire)) throw new Error('Motion Save journal checksum does not match.');
	if (wire.version === 2) return { journal: wire, checksum };
	return { journal: {
		format: wire.format, version: 2, transactionId: wire.transactionId, projectId: wire.projectId, phase: wire.phase,
		candidate: migrate(wire.candidate), sha256: wire.sha256, previous: wire.previous === null ? null : migrate(wire.previous),
		backup: wire.backup === null ? null : migrate(wire.backup), previousSha256: wire.previousSha256,
	}, checksum };
}

function normalizeJournal(value: unknown): WireJournal {
	const input = record(value, ['format', 'version', 'transactionId', 'projectId', 'phase', 'candidate', 'sha256', 'previous', 'backup', 'previousSha256']);
	if (input.format !== 'motionscaper-save-publication' || (input.version !== 1 && input.version !== 2)
		|| (input.phase !== 'pending' && input.phase !== 'published' && input.phase !== 'rolled-back')
		|| typeof input.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.projectId)) throw new Error('Unsupported Motion Save journal.');
	if ((input.previous === null) !== (input.previousSha256 === null) || (input.previous === null) !== (input.backup === null)) throw new Error('Motion Save prior backup metadata is incomplete.');
	const header: Pick<MotionSaveJournal, 'transactionId' | 'projectId' | 'phase'> = { transactionId: transaction(input.transactionId), projectId: input.projectId, phase: input.phase };
	const sha256 = digest(input.sha256), previousSha256 = input.previousSha256 === null ? null : digest(input.previousSha256);
	if (input.version === 1) return {
		format: 'motionscaper-save-publication', version: 1, ...header, candidate: legacyFingerprint(input.candidate), sha256,
		previous: input.previous === null ? null : legacyFingerprint(input.previous), backup: input.backup === null ? null : legacyFingerprint(input.backup), previousSha256,
	};
	return {
		format: 'motionscaper-save-publication', version: 2, ...header, candidate: fingerprint(input.candidate), sha256,
		previous: input.previous === null ? null : fingerprint(input.previous), backup: input.backup === null ? null : fingerprint(input.backup), previousSha256,
	};
}

function fingerprint(value: unknown): MotionSaveFingerprint {
	const input = record(value, fingerprintFields);
	if (typeof input.dev !== 'string' || typeof input.ino !== 'string') throw new Error('Motion Save v2 requires canonical filesystem identities.');
	const identity = canonicalNativeChildFileIdentity({ dev: input.dev, ino: input.ino });
	return { ...identity, ...measurements(input) };
}
function legacyFingerprint(value: unknown): LegacyFingerprint {
	const input = record(value, fingerprintFields);
	if (typeof input.dev !== 'number' || typeof input.ino !== 'number' || !Number.isSafeInteger(input.dev) || input.dev < 0
		|| !Number.isSafeInteger(input.ino) || input.ino < 0) throw new Error('Motion Save journal fingerprint exceeds its admission.');
	return { dev: input.dev, ino: input.ino, ...measurements(input) };
}
function measurements(input: Record<string, unknown>) {
	for (const field of ['size', 'mtimeMs', 'ctimeMs'] as const) {
		if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || Number(input[field]) < 0) throw new Error('Motion Save journal has an invalid fingerprint.');
	}
	if (!Number.isSafeInteger(input.size) || Number(input.size) > MAXIMUM_ARCHIVE_BYTES) throw new Error('Motion Save journal fingerprint exceeds its admission.');
	return { size: Number(input.size), mtimeMs: Number(input.mtimeMs), ctimeMs: Number(input.ctimeMs) };
}
function migrate(value: LegacyFingerprint): MotionSaveFingerprint {
	return { ...canonicalNativeChildFileIdentity({ dev: value.dev, ino: value.ino }), size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs };
}
function seal(value: WireJournal): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function transaction(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/u.test(value)) throw new Error('Invalid Motion Save transaction identity.');
	return value;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('Invalid Motion Save digest.');
	return value;
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw new Error('Motion Save journal has unsupported fields.');
	return value as Record<string, unknown>;
}
