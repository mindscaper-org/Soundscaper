/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperNativeRenderInputProducerAuthorityNativeMedia,
	FramescaperNativeRenderInputRequestNativeMedia,
} from './editor-native-render-input-producer.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_PLAN_BYTES = 65_536;

export function admitFramescaperNativeRenderInputAuthorityNativeMedia(
	value: unknown,
): FramescaperNativeRenderInputProducerAuthorityNativeMedia {
	const row = record(value, 'selected nativeMedia native render-input authority') as unknown as
		FramescaperNativeRenderInputProducerAuthorityNativeMedia;
	if (typeof row.authority?.begin !== 'function' || typeof row.store?.loadMediaAsset !== 'function') {
		throw new TypeError('Selected nativeMedia native render-input authority is incomplete.');
	}
	return row;
}

export function admitFramescaperNativeRenderInputRequestNativeMedia(
	value: unknown,
): FramescaperNativeRenderInputRequestNativeMedia {
	const row = record(value, 'selected nativeMedia native render-input request');
	const fields = ['planPayload', 'planFingerprint', 'projectId', 'projectRevision'];
	if (Reflect.ownKeys(row).length !== fields.length || fields.some((field) => !Object.hasOwn(row, field))
		|| typeof row.planPayload !== 'string'
		|| new TextEncoder().encode(row.planPayload).byteLength > MAXIMUM_PLAN_BYTES
		|| typeof row.planFingerprint !== 'string' || !SHA256.test(row.planFingerprint)
		|| typeof row.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(row.projectId)
		|| !Number.isSafeInteger(row.projectRevision) || Number(row.projectRevision) < 0) {
		throw new TypeError('The selected nativeMedia native render-input request is invalid.');
	}
	return Object.freeze({
		planPayload: row.planPayload, planFingerprint: row.planFingerprint,
		projectId: row.projectId, projectRevision: Number(row.projectRevision),
	});
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
