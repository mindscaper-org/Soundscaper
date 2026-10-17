/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperManagedProcessReceiptCurrentV1 } from './lightscaper-desktop-managed-smoke-process-current-v1.ts';

export const LIGHTSCAPER_WINDOWS_JOB_RECEIPT_MAXIMUM_BYTES_CURRENT_V1 = 16 * 1024;
export const LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1 = Object.freeze([
	'create-job', 'configure-job', 'duplicate-stdin', 'duplicate-stdout', 'duplicate-stderr',
	'initialize-attributes', 'inherit-handles', 'job-list', 'create-process', 'assign-job', 'verify-job', 'resume-thread',
	'wait-main', 'query-job', 'terminate-job', 'terminate-process', 'wait-terminated-main',
	'get-exit-code', 'close-thread', 'close-process', 'close-stdin', 'close-stdout', 'close-stderr',
	'close-job', 'supervisor',
] as const);
export type LightscaperWindowsJobFailureStageCurrentV1 = typeof LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1[number];
export interface LightscaperWindowsJobFailureCurrentV1 {
	readonly stage: LightscaperWindowsJobFailureStageCurrentV1; readonly code: number;
}
export interface LightscaperWindowsJobReceiptCurrentV1 {
	readonly schemaVersion: 1; readonly nonce: string; readonly stage: 1 | 2 | 3;
	readonly processId: number; readonly exitCode: number | null; readonly expired: boolean;
	readonly forcedTermination: boolean; readonly readersRetired: boolean;
	readonly activeProcesses: number | null; readonly failure: LightscaperWindowsJobFailureCurrentV1 | null;
	readonly cleanupFailures: readonly LightscaperWindowsJobFailureCurrentV1[];
}
export interface LightscaperWindowsJobProofCurrentV1 {
	readonly target: 'win-x64' | 'win-arm64'; readonly helperSha256: string;
	readonly helperProcessId: number; readonly helperExitCode: number | null;
	readonly helperSignal: string | null; readonly helperClosed: boolean; readonly outerExpired: boolean;
	readonly receipt: LightscaperWindowsJobReceiptCurrentV1 | null;
}
export interface LightscaperWindowsManagedProcessReceiptCurrentV1 extends LightscaperManagedProcessReceiptCurrentV1 {
	readonly windowsJob: LightscaperWindowsJobProofCurrentV1;
}

/** Only a freshly read, bounded helper receipt is evidence. No extra fields,
 * accessors, inherited authority, sparse arrays or stale launch identities. */
export function readLightscaperWindowsJobReceiptCurrentV1(value: unknown,
	expected: Readonly<{ nonce: string; stage: 1 | 2 | 3 }>,
): LightscaperWindowsJobReceiptCurrentV1 {
	assertLightscaperWindowsJobIdentityCurrentV1(expected.nonce, expected.stage);
	const fields = record(value, ['schemaVersion', 'nonce', 'stage', 'processId', 'exitCode', 'expired',
		'forcedTermination', 'readersRetired', 'activeProcesses', 'failure', 'cleanupFailures']);
	if (fields.schemaVersion !== 1 || fields.nonce !== expected.nonce || fields.stage !== expected.stage
		|| !uint32(fields.processId) || !(fields.exitCode === null || uint32(fields.exitCode))
		|| typeof fields.expired !== 'boolean' || typeof fields.forcedTermination !== 'boolean'
		|| typeof fields.readersRetired !== 'boolean'
		|| !(fields.activeProcesses === null || uint32(fields.activeProcesses))) throw malformed();
	const failure = fields.failure === null ? null : readFailure(fields.failure);
	const cleanupFailures = readFailures(fields.cleanupFailures);
	if (fields.processId === 0 && (fields.exitCode !== null || fields.activeProcesses !== null || failure === null)) throw malformed();
	if (fields.readersRetired && fields.processId !== 0 && fields.activeProcesses !== 0) throw malformed();
	if (failure === null && (fields.processId === 0 || (fields.exitCode === null && cleanupFailures.length === 0))) throw malformed();
	return Object.freeze({ schemaVersion: 1, nonce: expected.nonce, stage: expected.stage,
		processId: fields.processId, exitCode: fields.exitCode, expired: fields.expired,
		forcedTermination: fields.forcedTermination, readersRetired: fields.readersRetired,
		activeProcesses: fields.activeProcesses, failure, cleanupFailures });
}

export function assertLightscaperWindowsJobIdentityCurrentV1(nonce: string, stage: number): void {
	if (!/^[a-f0-9]{32}$/u.test(nonce) || ![1, 2, 3].includes(stage)) throw new TypeError('Invalid Windows Job launch identity.');
}

/** Main PID/exit come from the actual app receipt, never from the launcher.
 * A kill, lost close, nonzero supervisor exit or receipt error is unverified. */
export function lightscaperWindowsJobProcessReceiptCurrentV1(proof: LightscaperWindowsJobProofCurrentV1,
	output: Readonly<{ stdout: string; stderr: string; launchError: string | null }>,
): LightscaperWindowsManagedProcessReceiptCurrentV1 {
	const native = proof.receipt;
	const authenticated = proof.helperClosed && proof.helperExitCode === 0 && proof.helperSignal === null
		&& !proof.outerExpired && output.launchError === null && native !== null;
	const failures = native ? [native.failure, ...native.cleanupFailures].filter(value => value !== null) : [];
	const launchError = output.launchError ?? (!authenticated ? 'Windows Job supervisor terminal evidence is incomplete.'
		: failures.length ? `Windows Job native failure: ${JSON.stringify(failures)}` : null);
	return Object.freeze({ processId: native?.processId ?? 0, exitCode: native?.exitCode ?? null,
		signal: proof.helperSignal, stdout: output.stdout, stderr: output.stderr,
		expired: proof.outerExpired || (native?.expired ?? false), launchError,
		readersRetired: authenticated && native.readersRetired,
		forcedGroupRetirement: proof.outerExpired || (native?.forcedTermination ?? false),
		liveReaderIds: Object.freeze([]), unretiredOwnedGroupId: null,
		windowsJob: Object.freeze({ ...proof }) });
}

function readFailure(value: unknown): LightscaperWindowsJobFailureCurrentV1 {
	const fields = record(value, ['stage', 'code']);
	if (!LIGHTSCAPER_WINDOWS_JOB_FAILURE_STAGES_CURRENT_V1.some(stage => stage === fields.stage) || !uint32(fields.code)) throw malformed();
	return Object.freeze({ stage: fields.stage as LightscaperWindowsJobFailureStageCurrentV1, code: fields.code });
}
function readFailures(value: unknown): readonly LightscaperWindowsJobFailureCurrentV1[] {
	if (!Array.isArray(value)) throw malformed();
	const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
	if (!Number.isSafeInteger(length) || typeof length !== 'number' || length > 16 || length < 0
		|| Reflect.ownKeys(descriptors).length !== length + 1) throw malformed();
	const failures: LightscaperWindowsJobFailureCurrentV1[] = [];
	for (let index = 0; index < length; index++) {
		const field = descriptors[String(index)];
		if (!field || !field.enumerable || !('value' in field)) throw malformed();
		failures.push(readFailure(field.value));
	}
	return Object.freeze(failures);
}
function record(value: unknown, names: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformed();
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw malformed();
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== names.length) throw malformed();
	const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const name of names) {
		const descriptor = descriptors[name];
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw malformed();
		fields[name] = descriptor.value as unknown;
	}
	return fields;
}
function uint32(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
function malformed(): TypeError { return new TypeError('Invalid closed Windows Job terminal receipt.'); }
