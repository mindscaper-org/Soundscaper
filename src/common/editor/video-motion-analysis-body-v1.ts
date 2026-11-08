/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical motion body bytes, independent of motion estimation or frame readers. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	normalizeVideoProcessorStackV1,
	requireFreshVideoMotionAnalysisV1,
} from './video-motion-model-v27.ts';
import type { VideoSimilarityTransformV1 } from './video-motion-processing-v27.ts';

export interface VideoMotionAnalysisTransformV1 {
	readonly frameNumber: number;
	/** Deterministic camera motion from frameNumber - 1 into frameNumber. */
	readonly transform: VideoSimilarityTransformV1;
}

export interface VideoMotionAnalysisBodyV1 {
	readonly schemaVersion: 1;
	readonly analysisId: string;
	readonly sourceId: string;
	readonly processorStackId: string;
	readonly inputSha256: string;
	readonly settingsSha256: string;
	/** Pixel geometry in which every persisted translation was estimated. */
	readonly analysisWidth: number;
	readonly analysisHeight: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly transforms: readonly VideoMotionAnalysisTransformV1[];
}

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function videoMotionSettingsSha256V1(stackValue: unknown): string {
	const stack = normalizeVideoProcessorStackV1(stackValue);
	return bytesToHex(sha256(UTF8.encode(JSON.stringify(stack))));
}

/** Authenticate body bytes and reject stale source or settings authority. */
export function requireVideoMotionAnalysisBodyV1(
	referenceValue: unknown,
	bytesValue: Uint8Array,
	expected: Readonly<{ readonly inputSha256: string; readonly processorStack: unknown }>,
): VideoMotionAnalysisBodyV1 {
	const stack = normalizeVideoProcessorStackV1(expected?.processorStack);
	const settingsSha256 = videoMotionSettingsSha256V1(stack);
	const reference = requireFreshVideoMotionAnalysisV1(referenceValue, {
		sourceId: stack.sourceId,
		processorStackId: stack.id,
		inputSha256: expected?.inputSha256,
		settingsSha256,
	});
	const bytes = wholeBytes(bytesValue);
	if (bytes.byteLength !== reference.byteLength
		|| bytesToHex(sha256(bytes)) !== reference.sha256) {
		throw new RangeError('The motion analysis body digest or byte length changed.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(UTF8_DECODER.decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError('The motion analysis body is not canonical UTF-8 JSON.', { cause: error });
	}
	const body = normalizeVideoMotionAnalysisBodyV1(parsed);
	if (JSON.stringify(body) !== UTF8_DECODER.decode(bytes)) {
		throw new TypeError('The motion analysis body is not canonical JSON.');
	}
	if (body.analysisId !== reference.id || body.sourceId !== reference.sourceId
		|| body.processorStackId !== reference.processorStackId
		|| body.inputSha256 !== reference.inputSha256
		|| body.settingsSha256 !== reference.settingsSha256
		|| body.startFrame !== reference.startFrame || body.endFrame !== reference.endFrame) {
		throw new RangeError('The motion analysis body does not match its persisted reference.');
	}
	return body;
}

export function normalizeVideoMotionAnalysisBodyV1(value: unknown): VideoMotionAnalysisBodyV1 {
	const input = exactRecord(value, [
		'schemaVersion', 'analysisId', 'sourceId', 'processorStackId', 'inputSha256',
		'settingsSha256', 'analysisWidth', 'analysisHeight', 'startFrame', 'endFrame', 'transforms',
	], 'motion analysis body');
	if (input.schemaVersion !== 1) throw new RangeError('The motion analysis body schema is unsupported.');
	const startFrame = nonNegativeInteger(input.startFrame, 'motion analysis body start frame');
	const endFrame = nonNegativeInteger(input.endFrame, 'motion analysis body end frame');
	if (endFrame <= startFrame) throw new RangeError('The motion analysis body range must be positive.');
	if (!Array.isArray(input.transforms) || input.transforms.length !== endFrame - startFrame - 1) {
		throw new RangeError('The motion analysis body requires one transform per adjacent frame pair.');
	}
	const transforms = input.transforms.map((value, index) => normalizeTransform(
		value, startFrame + index + 1,
	));
	return Object.freeze({
		schemaVersion: 1 as const,
		analysisId: stableId(input.analysisId, 'motion analysis body ID'),
		sourceId: stableId(input.sourceId, 'motion analysis body source ID'),
		processorStackId: stableId(input.processorStackId, 'motion analysis body stack ID'),
		inputSha256: digest(input.inputSha256, 'motion analysis body input digest'),
		settingsSha256: digest(input.settingsSha256, 'motion analysis body settings digest'),
		analysisWidth: positiveInteger(input.analysisWidth, 'motion analysis body width'),
		analysisHeight: positiveInteger(input.analysisHeight, 'motion analysis body height'),
		startFrame,
		endFrame,
		transforms: Object.freeze(transforms),
	});
}

function normalizeTransform(value: unknown, expectedFrame: number): VideoMotionAnalysisTransformV1 {
	const input = exactRecord(value, ['frameNumber', 'transform'], 'motion analysis transform');
	if (input.frameNumber !== expectedFrame) throw new RangeError('Motion analysis transforms must be contiguous.');
	const transform = exactRecord(input.transform, [
		'scale', 'rotationRadians', 'translateX', 'translateY', 'inlierCount', 'meanError',
	], 'motion analysis similarity transform');
	return Object.freeze({
		frameNumber: expectedFrame,
		transform: Object.freeze({
			scale: finitePositive(transform.scale, 'motion scale'),
			rotationRadians: finite(transform.rotationRadians, 'motion rotation'),
			translateX: finite(transform.translateX, 'motion translateX'),
			translateY: finite(transform.translateY, 'motion translateY'),
			inlierCount: nonNegativeInteger(transform.inlierCount, 'motion inlier count'),
			meanError: finiteNonNegative(transform.meanError, 'motion mean error'),
		}),
	});
}

export function encodeVideoMotionAnalysisBodyV1(body: VideoMotionAnalysisBodyV1): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(UTF8.encode(JSON.stringify(body)));
}

function wholeBytes(value: unknown): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || value.byteOffset !== 0
		|| value.byteLength !== value.buffer.byteLength) {
		throw new TypeError('The motion analysis body requires one whole Uint8Array.');
	}
	return Uint8Array.from(value);
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${name} must be a plain record.`);
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} contains unsupported fields.`);
	}
	return record;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be finite.`);
	}
	return value;
}

function finitePositive(value: unknown, name: string): number {
	const result = finite(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function finiteNonNegative(value: unknown, name: string): number {
	const result = finite(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

