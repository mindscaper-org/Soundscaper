/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-private binding of baseline project source identities to managed bodies. */

import { prepareNativeMediaPlanEnvelopeWithDeferredTimingReferencesV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import type { NativeQueueInputFingerprintV1 } from '../src/common/editor/native-queue-record.ts';
import {
	validateFramescaperDesktopBodyDescriptor,
	type FramescaperDesktopBodyDescriptor,
} from '../src/framescaper/desktop-project-library-body-contract.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const BASE_KINDS = Object.freeze(['video-original', 'video-proxy', 'video-timing'] as const);

export type FramescaperNativeProjectMediaBody = FramescaperDesktopBodyDescriptor;

/** Admit the baseline body inventory without narrowing it to an older video-only subset. */
export function framescaperNativeProjectBody(value: unknown): Readonly<FramescaperNativeProjectMediaBody> {
	const row = record(value, 'baseline native project body');
	if (row.kind === 'image-sequence-inventory' || row.kind === 'image-sequence-source-pack') {
		return validateFramescaperDesktopBodyDescriptor(value);
	}
	if (!(BASE_KINDS as readonly unknown[]).includes(row.kind)
		|| typeof row.encoding !== 'string' || typeof row.sourceId !== 'string' || row.sourceId.length === 0
		|| row.storageKey !== row.sourceId || typeof row.mimeType !== 'string' || row.mimeType.length === 0
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new TypeError('A baseline native project body has invalid identity fields.');
	}
	return Object.freeze({
		kind: row.kind as FramescaperNativeProjectMediaBody['kind'], encoding: row.encoding,
		...(row.kind === 'video-proxy' && typeof row.bindingId === 'string'
			? { bindingId: row.bindingId } : {}),
		sourceId: row.sourceId, storageKey: row.sourceId, mimeType: row.mimeType,
		byteLength: Number(row.byteLength), sha256: row.sha256,
	});
}

/** Authenticate ordinary originals or both roots of each image-sequence source. */
export function framescaperNativeProjectPlanBodyMetadataMatches(
	plan: unknown,
	inputs: readonly NativeQueueInputFingerprintV1[],
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
): boolean {
	try { return prepareFramescaperNativeProjectBodyCustody(plan, bodies).metadataMatches(inputs); }
	catch { return false; }
}

/** Generic callers retain fresh plan and inventory admission on every call. */
export function framescaperNativeOriginalBodyForInput(
	plan: unknown,
	input: NativeQueueInputFingerprintV1,
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
): Readonly<FramescaperNativeProjectMediaBody> | null {
	return prepareFramescaperNativeProjectBodyCustody(plan, bodies).originalBodyForInput(input);
}

/** One operation owns its admitted plan, inventory snapshot and lookup tables. */
export function prepareFramescaperNativeProjectBodyCustody(plan: unknown, bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[]) {
	const canonical = prepareNativeMediaPlanEnvelopeWithDeferredTimingReferencesV2(plan).plan;
	const sources = new Map(canonical.sources.map(source => [source.sourceId, source]));
	const professional = new Map(canonical.nodes.flatMap(node => node.kind === 'professional-media' ? [[node.sourceNodeId, node] as const] : []));
	const inventory = new Map<string, FramescaperNativeProjectMediaBody[]>();
	for (const body of bodies) {
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('A native body inventory requires inert descriptor records.');
		const snapshot = Object.freeze({ ...body }); const key = `${body.kind}:${body.sourceId}`;
		const entries = inventory.get(key) ?? []; entries.push(snapshot); inventory.set(key, entries);
	}
	const onlyBody = (kind: FramescaperNativeProjectMediaBody['kind'], sourceId: string, matches: (body: FramescaperNativeProjectMediaBody) => boolean) => {
		const candidates = (inventory.get(`${kind}:${sourceId}`) ?? []).filter(matches);
		if (candidates.length !== 1) throw new Error('A native managed source body is absent or duplicated.');
		return candidates[0]!;
	};
	const originalBodyForInput = (input: NativeQueueInputFingerprintV1): Readonly<FramescaperNativeProjectMediaBody> | null => {
		const source = sources.get(input.sourceId);
		if (!source || source.contentSha256 !== input.sha256) throw new Error('A native source fingerprint is outside its exact plan.');
		const node = professional.get(source.nodeId);
		if (node && node.imageSequence !== null) {
			for (const [kind, reference] of [['image-sequence-inventory', node.imageSequence.inventory], ['image-sequence-source-pack', node.imageSequence.sourcePack]] as const) {
				onlyBody(kind, reference.storageKey, body => body.storageKey === reference.storageKey && body.sha256 === reference.sha256 && body.byteLength === reference.byteLength);
			}
			return null;
		}
		return onlyBody('video-original', input.sourceId, body => body.sha256 === input.sha256);
	};
	const timing = nativeMediaPlanVideoTimingAssetInputs(canonical);
	return Object.freeze({ originalBodyForInput, metadataMatches(inputs: readonly NativeQueueInputFingerprintV1[]): boolean {
		if (sources.size !== inputs.length || new Set(inputs.map(input => input.sourceId)).size !== inputs.length) return false;
		try {
			for (const input of inputs) originalBodyForInput(input);
			for (const input of timing) onlyBody('video-timing', input.storageKey, body => body.storageKey === input.storageKey && body.sha256 === input.sha256);
			return true;
		} catch { return false; }
	} });
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`A ${name} is malformed.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
