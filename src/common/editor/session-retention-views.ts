/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from './code-unit-order.ts';
import { collectProjectStorageKeys, editorHistoryProjects } from './retention.js';
import { collectTakeGroupSourceIds } from './take-group-source-references.ts';
import type { ProjectLinkedOriginalSourceReference } from './storage/project-publication-options.ts';
import type { AudioEditorSessionClipboard } from './session-clipboard-codec.ts';

interface SourceRoot { readonly id?: unknown; readonly kind?: unknown }
interface ClipRoot { readonly sourceId?: unknown; readonly kind?: unknown }
interface ProjectRoots {
	readonly sources?: readonly SourceRoot[];
	readonly clips?: readonly ClipRoot[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly ClipRoot[] }>;
	readonly featureRequirements?: Readonly<{
		readonly requirements?: readonly Readonly<{
			readonly fallback?: Readonly<{ readonly kind?: unknown; readonly sourceId?: unknown }> | null;
		}>[];
	}>;
	readonly assistanceAssets?: readonly Readonly<{ readonly sourceId?: unknown }>[];
}

/** Only detached scalar identities cross the private session-history boundary. */
export function collectHistoryLinkedOriginalSourceReferences(
	histories: readonly unknown[],
): readonly ProjectLinkedOriginalSourceReference[] {
	const references = new Map<string, ProjectLinkedOriginalSourceReference>();
	const add = (kind: 'audio' | 'video' | null, sourceId: unknown): void => {
		if (!kind || typeof sourceId !== 'string' || !sourceId) return;
		const reference = Object.freeze({ kind, sourceId });
		references.set(`${kind}:${sourceId}`, reference);
	};
	for (const history of histories) {
		for (const value of editorHistoryProjects(history)) {
			const project = value as ProjectRoots;
			const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
			const sourceKind = (sourceId: string): 'audio' | 'video' | null => {
				const kind = sourceById.get(sourceId)?.kind;
				return kind === undefined || kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : null;
			};
			const binClips = Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
			for (const clip of [...(project.clips || []), ...binClips]) {
				if (typeof clip.sourceId !== 'string' || !clip.sourceId) continue;
				add(linkedOriginalKind(clip.kind)
					?? (clip.kind === undefined ? sourceKind(clip.sourceId) : null), clip.sourceId);
			}
			for (const requirement of project.featureRequirements?.requirements || []) {
				const fallback = requirement.fallback;
				if (typeof fallback?.sourceId !== 'string' || !fallback.sourceId) continue;
				add(linkedOriginalKind(fallback.kind)
					?? (fallback.kind === undefined ? sourceKind(fallback.sourceId) : null), fallback.sourceId);
			}
			for (const sourceId of collectTakeGroupSourceIds(project)) add(sourceKind(sourceId), sourceId);
			for (const asset of project.assistanceAssets || []) {
				if (typeof asset.sourceId === 'string' && asset.sourceId) add(sourceKind(asset.sourceId), asset.sourceId);
			}
		}
	}
	return Object.freeze([...references.values()].sort((left, right) => (
		compareCodeUnits(left.kind, right.kind) || compareCodeUnits(left.sourceId, right.sourceId)
	)));
}

/** Preserve storage aliases and Framescaper body keys, not only logical source IDs. */
export function collectHistoryStorageKeys(histories: readonly unknown[]): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const history of histories) {
		for (const project of editorHistoryProjects(history)) collectProjectStorageKeys(project, keys);
	}
	return keys;
}

/** A copied source keeps physical media and its required sidecars after its origin tab closes. */
export function collectSessionClipboardStorageKeys(
	clipboard: Pick<AudioEditorSessionClipboard, 'sources'> | null,
): Set<string> {
	const keys = new Set<string>();
	const retainBody = (value: unknown): void => {
		const key = record(value)?.storageKey;
		if (typeof key === 'string' && key) keys.add(key);
	};
	for (const source of clipboard?.sources ?? []) {
		keys.add(source.id);
		retainBody(source);
		retainBody(source.timingAsset);
		const proxy = record(source.proxyAttachment);
		retainBody(proxy);
		retainBody(proxy?.timingAsset);
		const sequence = record(source.imageSequence);
		retainBody(sequence?.sourcePack);
		retainBody(sequence?.inventory);
	}
	return keys;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}

function linkedOriginalKind(value: unknown): 'audio' | 'video' | null {
	return value === 'audio' || value === 'video' ? value : null;
}
