/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestBytes } from '../../../../../media/bytes.ts';
import { SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE } from '../../../../audacity-binary-xml-values.ts';
import { SCAPE_PROJECT_BINARY_HARD_LIMITS as limits } from '../../../../scape-project-document.ts';

interface AudacityBlob {
	readonly kind: 'blob';
	readonly name: string;
	readonly value: Uint8Array;
}

/** Fit optional Audacity XML records into the existing Scape binary budget. */
export function fitAudacityOpaqueBinary<Project extends object>(project: Project) {
	const blobs: AudacityBlob[] = [];
	let retainedBytes = 0;
	let retainedCount = 0;
	let nativeBytes = 0;
	let largestNativeBlob = 0;
	visit(project);
	if (largestNativeBlob <= limits.maximumPayloadBytes
		&& retainedBytes + nativeBytes <= limits.maximumTotalPayloadBytes
		&& retainedCount + blobs.length <= limits.maximumPayloadCount) return { project, omission: null };

	// Imported editor racks and their XML templates can hold copies of the same record.
	// Keep or omit those copies together so native export cannot revive an omitted body.
	const groups = new Map<string, AudacityBlob[]>();
	const omitted = new Set<AudacityBlob>();
	for (const blob of blobs) {
		if (blob.value.byteLength > limits.maximumPayloadBytes) {
			omitted.add(blob);
			continue;
		}
		const key = `${digestBytes(blob.value)}:${blob.name}`;
		const group = groups.get(key);
		if (group) group.push(blob);
		else groups.set(key, [blob]);
	}
	for (const group of groups.values()) {
		const groupBytes = group[0]!.value.byteLength * group.length;
		if (retainedBytes + groupBytes > limits.maximumTotalPayloadBytes
			|| retainedCount + group.length > limits.maximumPayloadCount) {
			for (const blob of group) omitted.add(blob);
			continue;
		}
		retainedBytes += groupBytes;
		retainedCount += group.length;
	}
	if (!omitted.size) return { project, omission: null };
	return {
		project: withoutOmittedBlobs(project, omitted) as Project,
		omission: {
			code: 'AUDACITY_OPAQUE_BINARY_OMITTED', severity: 'warning', disposition: 'omitted',
			scope: { kind: 'project' }, data: { originalFilePreserved: true },
			message: 'Some Audacity binary project or plug-in data exceeded Soundscaper’s storage limits and was left in the original file. Editable audio and timing were retained.',
		},
	};

	function visit(value: unknown): void {
		if (!value || typeof value !== 'object') return;
		if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
			retainedBytes += value.byteLength;
			retainedCount += 1;
			return;
		}
		if (Array.isArray(value)) {
			for (const entry of value as readonly unknown[]) {
				if (isAudacityBlob(entry)) {
					blobs.push(entry);
					nativeBytes += entry.value.byteLength;
					largestNativeBlob = Math.max(largestNativeBlob, entry.value.byteLength);
				} else visit(entry);
			}
			return;
		}
		for (const child of Object.values(value)) visit(child);
	}
}

function isAudacityBlob(value: unknown): value is AudacityBlob {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Partial<AudacityBlob>;
	return entry.kind === 'blob' && typeof entry.name === 'string' && entry.value instanceof Uint8Array;
}

function withoutOmittedBlobs(value: unknown, omitted: ReadonlySet<AudacityBlob>): unknown {
	if (!value || typeof value !== 'object' || value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
	if (Array.isArray(value)) {
		return (value as readonly unknown[]).filter(entry => !shouldOmitEntry(entry, omitted))
			.map(entry => withoutOmittedBlobs(entry, omitted));
	}
	const output = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withoutOmittedBlobs(entry, omitted)]));
	const extensions = value as {
		aup4MasterEffectsContentIndex?: number;
		aup4RootTemplate?: { node?: { content?: readonly unknown[] } };
	};
	const index = extensions.aup4MasterEffectsContentIndex;
	const content = extensions.aup4RootTemplate?.node?.content;
	if (index !== undefined && index >= 0 && Array.isArray(content)) {
		output.aup4MasterEffectsContentIndex = (content as readonly unknown[]).slice(0, index)
			.filter(entry => !shouldOmitEntry(entry, omitted)).length;
	}
	return output;
}

function shouldOmitEntry(value: unknown, omitted: ReadonlySet<AudacityBlob>): boolean {
	if (isAudacityBlob(value)) return omitted.has(value);
	const entry = value as { kind?: unknown; node?: { name?: unknown; content?: unknown } } | null;
	return entry?.kind === 'node' && entry.node?.name === SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE
		&& containsOmittedBlob(entry.node.content, omitted);
}

function containsOmittedBlob(value: unknown, omitted: ReadonlySet<AudacityBlob>): boolean {
	if (!value || typeof value !== 'object' || value instanceof Uint8Array || value instanceof ArrayBuffer) return false;
	if (isAudacityBlob(value)) return omitted.has(value);
	return Object.values(value).some(entry => containsOmittedBlob(entry, omitted));
}
