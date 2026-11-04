/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorControllerLifetime } from '../shared/lifecycle.ts';
import type { ScapeProjectInput } from '../../scape-project-input.ts';
import type { ProjectRecoveryChange } from '../../project-recovery-reason.ts';
import { withProjectOpenRecovery } from './project-open-recovery.ts';

export const SCAPE_OPEN_REQUEST_TASK = 'scape-open-request';

export type ScapeCollisionChoice = 'copy' | 'replace' | 'cancel';
export type ScapeOpenDecisionChoice = ScapeCollisionChoice | 'open-read-only' | 'copy-read-only';
export type ScapeOpenDecisionKind = 'compatibility' | 'collision' | 'compatibility-collision' | 'recovery';

export interface ScapeOpenInspection {
	readonly exists: boolean;
	readonly featureRequirementsCompatibility?: Readonly<{ compatible: boolean }> | null;
	readonly recoveryChanges?: readonly ProjectRecoveryChange[];
	readonly [name: string]: unknown;
}

export type ScapeOpenRequestOptions = Readonly<Record<string, unknown>> & Readonly<{
	signal?: AbortSignal;
}>;

export interface ScapeOpenDecisionRequest<Inspection extends ScapeOpenInspection> {
	readonly kind: ScapeOpenDecisionKind;
	readonly file: ScapeProjectInput;
	readonly inspected: Inspection;
	readonly signal: AbortSignal;
}

export type ScapeOpenDecisionRequester<Inspection extends ScapeOpenInspection> = (
	request: ScapeOpenDecisionRequest<Inspection>,
) => PromiseLike<ScapeOpenDecisionChoice> | ScapeOpenDecisionChoice;

export interface ScapeOpenRequestRuntime<Inspection extends ScapeOpenInspection, Result> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly inspectScape: (
		file: ScapeProjectInput,
		options: ScapeOpenRequestOptions & Readonly<{ signal: AbortSignal }>,
	) => PromiseLike<Inspection> | Inspection;
	readonly openScape: (
		file: ScapeProjectInput,
		options: Readonly<{
			collision: Exclude<ScapeCollisionChoice, 'cancel'>;
			recover?: boolean;
			signal: AbortSignal;
		}>,
	) => PromiseLike<Result> | Result;
}

const CANCELLED = Object.freeze({ cancelled: true as const });

export function createScapeOpenRequestService<
	Inspection extends ScapeOpenInspection,
	Result,
>(runtime: ScapeOpenRequestRuntime<Inspection, Result>) {
	return Object.freeze({ openScapeFile });

	async function openScapeFile(
		file: ScapeProjectInput,
		requestOpenDecision: ScapeOpenDecisionRequester<Inspection>,
		options: ScapeOpenRequestOptions = {},
	): Promise<Result | typeof CANCELLED> {
		const task = runtime.lifetime.startTask(SCAPE_OPEN_REQUEST_TASK);
		try {
			const snapshot = { ...options };
			const signal = snapshot.signal
				? AbortSignal.any([task.signal, snapshot.signal])
				: task.signal;
			const ownedOptions = Object.freeze({ ...snapshot, recover: false, signal });
			throwIfAborted(signal);
			let recoveryAttempted = false;
			const openInspected = async (inspected: Inspection): Promise<Result | typeof CANCELLED> => {
				let collision: Exclude<ScapeCollisionChoice, 'cancel'> = 'copy';
				recoveryAttempted ||= Boolean(inspected.recoveryChanges?.length);
				throwIfAborted(signal);
				task.assertCurrent();
				const kind = getOpenDecisionKind(inspected);
				if (kind !== null) {
					const choice = await awaitWithSignal(requestOpenDecision(Object.freeze({ kind, file, inspected, signal })), signal);
					throwIfAborted(signal);
					task.assertCurrent();
					if (choice === 'cancel') return CANCELLED;
					collision = resolveOpenDecision(kind, choice);
				}
				const result = await awaitWithSignal(runtime.openScape(file, Object.freeze({
					collision, signal, recover: recoveryAttempted,
				})), signal);
				throwIfAborted(signal);
				task.assertCurrent();
				return result;
			};
			return await withProjectOpenRecovery(
				async () => openInspected(await awaitWithSignal(runtime.inspectScape(file, ownedOptions), signal)),
				async () => {
					throwIfAborted(signal);
					task.assertCurrent();
					if (recoveryAttempted) return null;
					recoveryAttempted = true;
					const inspected = await awaitWithSignal(runtime.inspectScape(file, { ...ownedOptions, recover: true }), signal);
					throwIfAborted(signal);
					task.assertCurrent();
					return inspected.recoveryChanges?.length ? { value: await openInspected(inspected) } : null;
				},
			);
		} finally {
			task.finish();
		}
	}
}

function getOpenDecisionKind(inspected: ScapeOpenInspection): ScapeOpenDecisionKind | null {
	const incompatible = inspected.featureRequirementsCompatibility?.compatible === false;
	if (incompatible) return inspected.exists ? 'compatibility-collision' : 'compatibility';
	if (inspected.recoveryChanges?.length) return 'recovery';
	return inspected.exists ? 'collision' : null;
}

function resolveOpenDecision(
	kind: ScapeOpenDecisionKind,
	value: unknown,
): Exclude<ScapeCollisionChoice, 'cancel'> {
	if (kind === 'compatibility' && value === 'open-read-only') return 'copy';
	if (kind === 'compatibility-collision' && value === 'copy-read-only') return 'copy';
	if (kind === 'collision' && (value === 'copy' || value === 'replace')) return value;
	if (kind === 'recovery' && value === 'copy') return 'copy';
	if (kind === 'compatibility') {
		throw new RangeError('Choose open read-only or cancel for the incompatible Scape project.');
	}
	if (kind === 'compatibility-collision') {
		throw new RangeError('Choose a read-only copy or cancel for the incompatible Scape project collision.');
	}
	throw new RangeError('Choose copy, replace, or cancel for the existing Scape project.');
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason;
}

function awaitWithSignal<Value>(value: PromiseLike<Value> | Value, signal: AbortSignal): Promise<Value> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (action: (result: Value | unknown) => void, result: Value | unknown) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			action(result);
		};
		const onAbort = () => finish(reject, signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		Promise.resolve(value).then(
			(result) => finish(resolve as (result: Value | unknown) => void, result),
			(error: unknown) => finish(reject, error),
		);
	});
}
