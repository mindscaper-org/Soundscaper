/* SPDX-License-Identifier: AGPL-3.0-only */

import { deferredArchiveRuntime } from '../common/editor/controller/document/deferred-archive-runtime.ts';
import { withProjectOpenRecovery } from '../common/editor/controller/document/project-open-recovery.ts';
import type { ProjectRecoveryChange } from '../common/editor/project-recovery-reason.ts';
import type { SoundscaperScapeRecoveryOptions } from './editor-scape-recovery.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../common/editor/project-schema-identity.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	adaptSoundscaperScapeNativePluginStateStore,
	type SoundscaperScapeNativePluginStateStore,
} from './editor-native-plugin-state-scape.ts';
import { createSoundscaperProjectFeatureCompatibilityService } from
	'./editor-project-feature-compatibility.ts';
import { rebindSoundscaperProjectSourceIdentities } from './editor-project-feature-requirements.ts';
import {
	cloneSoundscaperProject,
	loadSoundscaperProject,
	type SoundscaperProject,
} from './editor-project.ts';
import { createSoundscaperScapeProjectAssetExtension } from './editor-scape-assets.ts';

export interface SoundscaperScapeNativeStore extends SoundscaperScapeNativePluginStateStore {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Bind portable archive I/O to the family-qualified Soundscaper baseline. */
export function createSoundscaperScapeNativeRuntime() {
	const { copyFutureScapeArchive, exportScapeProject, importScapeProject, inspectScapeProject } =
		deferredArchiveRuntime;
	const compatibility = createSoundscaperProjectFeatureCompatibilityService();
	const projectAssetExtension = createSoundscaperScapeProjectAssetExtension();
	const loadProject = (value: unknown) => loadSoundscaperProject(value);
	async function openWithRecovery<Result extends object>(input: ScapeProjectInput,
		options: Readonly<Record<string, unknown>> & SoundscaperScapeRecoveryOptions,
		open: (input: ScapeProjectInput, options: Readonly<Record<string, unknown>>) => Promise<Result>,
	): Promise<Result & { readonly recoveryChanges?: readonly ProjectRecoveryChange[] }> {
		const recover = async () => {
			const { recoverSoundscaperScape } = await import('./editor-scape-recovery.ts');
			return recoverSoundscaperScape(input, { ...options, projectAssetExtension },
				(file, overrides) => open(file, { ...options, ...overrides }));
		};
		if (options.recover === true) {
			const recovered = await recover();
			if (recovered) return recovered;
		}
		return withProjectOpenRecovery(() => open(input, options), async () => {
			if (options.recover !== undefined) return null;
			const recovered = await recover();
			return recovered ? { value: recovered } : null;
		});
	}
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStore | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => openWithRecovery(input, options, (file, currentOptions) => inspectScapeProject(file, store, {
			...currentOptions,
			loadProject,
			currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
			currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention)),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStore,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const adaptedStore = adaptSoundscaperScapeNativePluginStateStore(store);
			const result = await openWithRecovery(input, options, (file, currentOptions) => importScapeProject(file, adaptedStore, {
				...currentOptions,
				loadProject,
				currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
				currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
				rebindProjectSourceIdentities: rebindSoundscaperProjectSourceIdentities,
				projectAssetExtension,
			}));
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneSoundscaperProject(result.project) });
		},
		exportScapeProject: (
			project: SoundscaperProject | unknown,
			store: SoundscaperScapeNativeStore,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(
			cloneSoundscaperProject(project),
			adaptSoundscaperScapeNativePluginStateStore(store),
			{
				...options,
				currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
				currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
				projectAssetExtension,
			},
		),
		copyScapeArchive: (
			input: ScapeProjectInput,
			write: (bytes: Uint8Array) => void | PromiseLike<void>,
			options: Readonly<Record<string, unknown>> = {},
		) => copyFutureScapeArchive(input, write, {
			...options,
			currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
			projectAssetExtension,
		}),
	});
}
