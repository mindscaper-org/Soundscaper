/* SPDX-License-Identifier: AGPL-3.0-only */

import { SOUNDSCAPER_DATABASE_NAME } from './editor-databases.js';

// Layout updates publish optimistically. A completed, fresh settings read must
// observe the resized layout before navigation can test its restoration.
export async function savedWorkspacePanels(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onupgradeneeded = () => opening.transaction.abort();
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const transaction = database.transaction('settings', 'readonly');
			const request = transaction.objectStore('settings').get('soundscaper:audio-editor-preferences-v1');
			transaction.onabort = () => { database.close(); reject(transaction.error); };
			transaction.oncomplete = () => {
				database.close();
				resolve(request.result?.value?.workspace?.panels ?? null);
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
