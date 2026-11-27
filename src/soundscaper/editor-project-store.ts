/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts'
import { LinkedOriginalProjectReachabilityRepository } from '../common/editor/storage/linked-original-project-reachability-repository.ts'
import { LinkedOriginalStartupReconciliationRepository } from '../common/editor/storage/linked-original-startup-reconciliation-repository.ts'
import {
	createStorageRepositories,
	type StorageRepositories,
	type StorageRepositoryOptions,
} from '../common/editor/storage/repositories.ts'
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts'
import { createProjectStore, type AudioEditorProjectStore } from '../common/editor/storage.js'
import { SoundscaperProjectRepository } from './editor-project-repository.ts'
import { validateSoundscaperProject } from './editor-project-validation.ts'
import { SOUNDSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts'

const AUTHORITY_FIELDS = new Set([
	'projectStorageProfile', 'databaseName', 'store', 'repositoryFactory', 'desktopProjectBridge', 'ephemeralMemory',
])

/** Construct the isolated selected store with exact V30 validation on every project operation. */
export function createSoundscaperProjectStore(
	optionsValue: AudioEditorProjectStoreOptions | unknown = {},
): AudioEditorProjectStore {
	const options = copyCreationOptions(optionsValue)
	return createSelectedStore(options)
}

/** Explicit temporary authority retains the exact product profile without shared library state. */
export function createSoundscaperEphemeralProjectStore(): AudioEditorProjectStore {
	return createSelectedStore({ indexedDB: null, preferOpfs: false, memoryFallback: true, ephemeralMemory: true })
}

function createSelectedStore(options: AudioEditorProjectStoreOptions): AudioEditorProjectStore {
	return createProjectStore({
		...options,
		projectStorageProfile: SOUNDSCAPER_PROJECT_STORAGE_PROFILE,
		repositoryFactory: soundscaperRepositoryFactory,
	})
}

function soundscaperRepositoryFactory(
	port: StorageRepositoryPort,
	options: StorageRepositoryOptions,
): StorageRepositories {
	const selectedPort = Object.freeze({ ...port, validateProjectForRetention: validateSoundscaperProject })
	const repositories = createStorageRepositories(selectedPort, options)
	return Object.freeze({
		...repositories,
		projects: new SoundscaperProjectRepository(repositories.projects),
		linkedOriginalProjectReachability: new LinkedOriginalProjectReachabilityRepository(port, {
			validateProject: validateSoundscaperProject,
		}),
		linkedOriginalStartupReconciliation: new LinkedOriginalStartupReconciliationRepository(port, {
			validateProject: validateSoundscaperProject,
		}),
	})
}

function copyCreationOptions(value: unknown): AudioEditorProjectStoreOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper baseline store options must be a plain record.')
	}
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper baseline store options must be a plain record.')
	}
	const output: Record<string, unknown> = {}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError('Soundscaper baseline store options cannot contain symbols.')
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Soundscaper baseline store option ${key} must be an own data property.`)
		}
		if (AUTHORITY_FIELDS.has(key)) {
			throw new TypeError(`The baseline store rejects the ${key} authority override.`)
		}
		output[key] = descriptor.value
	}
	return output as AudioEditorProjectStoreOptions
}
