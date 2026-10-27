/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAssistanceOperation, type AssistanceOperation } from '../../../../assistance/operation.ts';
import { normalizeLocalAssistanceShotDetectionMode, type LocalAssistanceShotDetectionMode } from '../../../../assistance/shot-detection-mode.ts';

export interface LocalAssistanceSelectedVideoPreparationRequest {
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly inputRole?: 'video' | 'frame-pack';
	/** Owned by Guided Reframe, whose reviewed output must fit the selected project. */
	readonly publicationTarget?: 'reframe';
	readonly signal?: AbortSignal;
}

export function localAssistanceSelectedVideoPreparationRequest(value: unknown): Readonly<{
	sourceId: string;
	operation: AssistanceOperation;
	shotDetectionMode: LocalAssistanceShotDetectionMode;
	inputRole?: 'video' | 'frame-pack';
	publicationTarget?: 'reframe';
	signal?: AbortSignal;
}> {
	const fields = ['sourceId', 'operation', 'shotDetectionMode', 'inputRole', 'publicationTarget', 'signal'];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Object.hasOwn(value, 'sourceId') || !Object.hasOwn(value, 'operation')
		|| Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Selected-video preparation requires its exact request.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) {
		throw new TypeError('Selected-video preparation requires a valid cancellation signal.');
	}
	const operation = normalizeAssistanceOperation(record.operation);
	if (operation !== 'shot-detection' && Object.hasOwn(record, 'shotDetectionMode')) {
		throw new TypeError('Visual model preparation cannot carry a shot-detection mode.');
	}
	const publicationTarget = record.publicationTarget;
	if (publicationTarget !== undefined && (publicationTarget !== 'reframe'
		|| operation !== 'subject-detection' && operation !== 'saliency-detection')) {
		throw new TypeError('Selected-video publication target is unsupported.');
	}
	const inputRole = record.inputRole;
	if (inputRole !== undefined && (operation !== 'shot-detection'
		|| inputRole !== 'video' && inputRole !== 'frame-pack')) {
		throw new TypeError('Selected-video input-role preparation is unsupported.');
	}
	const shotDetectionMode = Object.hasOwn(record, 'shotDetectionMode')
		? normalizeLocalAssistanceShotDetectionMode(record.shotDetectionMode) : 'fast';
	if (inputRole === 'frame-pack' && shotDetectionMode !== 'accurate') {
		throw new TypeError('Frame-pack shot preparation requires Accurate mode.');
	}
	if (typeof record.sourceId !== 'string' || record.sourceId.length < 1 || record.sourceId.length > 256) {
		throw new TypeError('The selected requested source ID is invalid.');
	}
	return Object.freeze({ sourceId: record.sourceId, operation, shotDetectionMode,
		...(inputRole ? { inputRole } : {}), ...(publicationTarget ? { publicationTarget } : {}),
		...(record.signal ? { signal: record.signal } : {}) });
}
