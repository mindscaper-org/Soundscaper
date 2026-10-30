/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import {
	BINARY_PATH_REFERENCE_INDEX_NAME,
	MEDIA_ASSET_CHUNK_STORE_NAME,
	MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
	MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
} from './media-asset-chunk-schema.ts';
import {
	MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME,
	MEDIA_ASSET_STAGING_KIND_INDEX_NAME,
	MEDIA_ASSET_STAGING_PATH_INDEX_NAME,
	MEDIA_ASSET_STAGING_STATE_KEY,
	MEDIA_ASSET_STAGING_STORE_NAME,
	MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME,
} from './media-asset-staging-schema.ts';
import {
	LINKED_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_STORE_NAME,
} from './linked-original-schema.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from './linked-original-provisional-root-schema.ts';
import { EditorStoreBlockedError } from './status.ts';

export const EDITOR_STORAGE_DATABASE_VERSION = 1;
const DATABASE_VERSION = EDITOR_STORAGE_DATABASE_VERSION;

interface EditorStorageMigration {
	readonly version: number;
	apply(database: IDBDatabase, abortUpgrade: (error: unknown) => void): void;
}

const EDITOR_STORAGE_MIGRATIONS: readonly EditorStorageMigration[] = Object.freeze([
	Object.freeze({ version: 1, apply: createBaselineStorageSchema }),
]);

export function openDatabase(
	indexedDB: IDBFactory,
	databaseName: string,
	onVersionChange: () => void = () => undefined,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let openRequest: IDBOpenDBRequest;
		let settled = false;
		let upgradeError: Error | null = null;
		try {
			openRequest = indexedDB.open(databaseName, DATABASE_VERSION);
		} catch (error) {
			reject(error);
			return;
		}
		const abortUpgrade = (error: unknown): void => {
			upgradeError ||= error instanceof Error
				? error
				: new Error('Could not upgrade editor storage.');
			const transaction = openRequest.transaction;
			if (transaction) {
				try {
					transaction.abort();
					return;
				} catch { /* The request may already have aborted the transaction. */ }
			}
			if (settled) return;
			settled = true;
			reject(upgradeError);
		};
		openRequest.onupgradeneeded = (event) => {
			try {
				const database = openRequest.result;
				const oldVersion = event?.oldVersion ?? 0;
				const newVersion = event?.newVersion ?? DATABASE_VERSION;
				for (const migration of EDITOR_STORAGE_MIGRATIONS) {
					if (migration.version > oldVersion && migration.version <= newVersion) {
						migration.apply(database, abortUpgrade);
					}
				}
			} catch (error) {
				abortUpgrade(error);
			}
		};
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			if (settled || upgradeError) {
				database.close();
				if (!settled) {
					settled = true;
					reject(upgradeError);
				}
				return;
			}
			settled = true;
			database.onversionchange = () => {
				database.close();
				onVersionChange();
			};
			resolve(database);
		};
		openRequest.onerror = () => {
			if (settled) return;
			settled = true;
			reject(upgradeError || openRequest.error || new Error('Could not open editor storage.'));
		};
		openRequest.onblocked = () => {
			if (settled) return;
			settled = true;
			reject(new EditorStoreBlockedError());
		};
	});
}

/**
 * The first shipped browser layout. Future versions append migrations to the
 * registry above; they never drop or recreate stores carrying baseline data.
 */
function createBaselineStorageSchema(
	database: IDBDatabase,
	abortUpgrade: (error: unknown) => void,
): void {
	database.createObjectStore('projects', { keyPath: 'id' });
	const revisions = database.createObjectStore('revisions', { keyPath: 'key' });
	revisions.createIndex('projectId', 'projectId', { unique: false });
	database.createObjectStore('settings', { keyPath: 'key' });
	database.createObjectStore('analysis', { keyPath: 'key' });
	const sources = database.createObjectStore('sources', { keyPath: 'id' });
	sources.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
	const sourceChunks = database.createObjectStore('sourceChunks', { keyPath: 'key' });
	sourceChunks.createIndex('sourceToken', 'sourceToken', { unique: false });
	const mediaAssets = database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
	for (const indexName of [
		MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
		BINARY_PATH_REFERENCE_INDEX_NAME,
	]) {
		mediaAssets.createIndex(indexName, indexName, { unique: false });
	}
	const mediaChunks = database.createObjectStore(MEDIA_ASSET_CHUNK_STORE_NAME, { keyPath: 'key' });
	mediaChunks.createIndex(
		MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
		MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
		{ unique: false },
	);
	const staging = database.createObjectStore(MEDIA_ASSET_STAGING_STORE_NAME, { keyPath: 'key' });
	staging.createIndex(MEDIA_ASSET_STAGING_KIND_INDEX_NAME, MEDIA_ASSET_STAGING_KIND_INDEX_NAME, { unique: false });
	staging.createIndex(MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME, MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME, { unique: true });
	staging.createIndex(MEDIA_ASSET_STAGING_PATH_INDEX_NAME, MEDIA_ASSET_STAGING_PATH_INDEX_NAME, { unique: true });
	staging.createIndex(MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME, MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME, { unique: false });
	const stateRequest = staging.put({
		key: MEDIA_ASSET_STAGING_STATE_KEY,
		kind: 'state',
		generation: 'initial',
	});
	stateRequest.onerror = () => abortUpgrade(
		stateRequest.error || new Error('Could not initialize media staging maintenance state.'),
	);
	const linkedVideoOriginals = database.createObjectStore(
		LINKED_ORIGINAL_STORE_NAME,
		{ keyPath: 'key' },
	);
	linkedVideoOriginals.createIndex(
		LINKED_ORIGINAL_PROJECT_INDEX_NAME,
		LINKED_ORIGINAL_PROJECT_INDEX_NAME,
		{ unique: false },
	);
	const linkedOriginalProvisionalRoots = database.createObjectStore(
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		{ keyPath: 'key' },
	);
	linkedOriginalProvisionalRoots.createIndex(
		LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
		{ unique: false },
	);
	for (const storeName of [VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME]) {
		const store = database.createObjectStore(storeName, { keyPath: 'key' });
		store.createIndex(
			DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
			DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
			{ unique: false },
		);
		store.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
	}
}
