/* SPDX-License-Identifier: AGPL-3.0-only */

import { EditorStoreBlockedError } from './status.ts';
import { applyEditorStorageMigrations, EDITOR_STORAGE_DATABASE_VERSION } from './indexeddb-schema.ts';
export { EDITOR_STORAGE_DATABASE_VERSION } from './indexeddb-schema.ts';

const DATABASE_VERSION = EDITOR_STORAGE_DATABASE_VERSION;

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
				applyEditorStorageMigrations(database, oldVersion, newVersion, openRequest.transaction, abortUpgrade);
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
