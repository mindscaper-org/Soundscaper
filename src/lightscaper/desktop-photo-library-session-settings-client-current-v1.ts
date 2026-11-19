/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, cloneDesktopPhotoValueCurrentV1 as clone,
	desktopPhotoVoidCurrentV1 as empty, desktopPhotoBooleanCurrentV1 as bool } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { photoImportIntentKeyV1, normalizePhotoImportIntentV1 } from './import/import-intent-v1.ts';
import { photoImportPresetsKeyV1 } from './storage/photo-import-presets-v1.ts';
import { photoDevelopPresetsKeyV1 } from './storage/photo-develop-presets-v1.ts';
import { photoExportPresetsKeyV1 } from './storage/photo-raster-export-presets-v1.ts';
import { photoRasterExportJournalKeyV1 } from './storage/photo-raster-export-journal-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';

const ACK = (value: boolean): boolean => value === true;
export function createDesktopPhotoSessionSettingsCurrentV1(c: Calls): Storage['components']['settings'] {
	const repository: Storage['components']['settings']['settingsRepository'] = Object.freeze<Storage['components']['settings']['settingsRepository']>({
		get: key => c.send('settings', () => ({ operation: 'get', domain: domain(key, false) }), clone),
		readEntry: key => c.send('settings', () => ({ operation: 'read-entry', domain: domain(key, false) }), entry),
		put: (key, value) => c.send('settings', () => ({ operation: 'put', domain: domain(key, false), value: clone(value) }), clone, undefined, false, true),
		delete: key => c.send('settings', () => ({ operation: 'delete', domain: domain(key, false) }), empty, undefined, false, true),
		putIfAbsent: (key, value) => c.send('settings', () => ({ operation: 'put-if-absent', domain: domain(key, false), value: clone(value) }), bool, undefined, false, ACK),
		replaceIfCurrent: (key, expected, replacement) => c.send('settings', () => ({ operation: 'replace-if-current', domain: domain(key, false), expected: clone(expected), replacement: clone(replacement) }), bool, undefined, false, ACK),
		deleteIfCurrent: (key, expected) => c.send('settings', () => ({ operation: 'delete-if-current', domain: domain(key, false), expected: clone(expected) }), bool, undefined, false, ACK),
		replaceIfCurrentAndPutIfAbsent: (key, expected, replacement, intentKey, intent, writeAdmission) => c.send('settings', () => {
			if (writeAdmission !== undefined) throw new TypeError('Renderer settings cannot transfer a SQL admission callback.');
			return { operation: 'replace-and-put-if-absent', domain: domain(key, false), expected: clone(expected), replacement: clone(replacement), intentDomain: domain(intentKey, false), intent: clone(intent) };
		}, bool, undefined, false, ACK),
	});
	return Object.freeze({ settingsRepository: repository,
		readSessionDomainEntryCurrentV1: (catalogId: string, domain: unknown) => c.own(() => { c.catalog(catalogId); if (domain === 'import-presets') throw new TypeError('Selected settings cannot read fixed-anchor import presets.'); return c.send('settings', () => ({ operation: 'read-entry', domain }), entry); }),
		readImportIntentCurrentV1: catalogId => c.own(() => {
		c.catalog(catalogId); return c.send('settings', () => ({ operation: 'read-import-intent' }), value => value === null ? null : normalizePhotoImportIntentV1(value, catalogId));
	}) });
	function domain(key: unknown, anchor: boolean): string { return selectedDomain(c.descriptor.catalogId, key, anchor); }
}
export function createDesktopPhotoSessionImportPresetsCurrentV1(c: Calls): Storage['importPresets'] {
	const domain = (key: unknown): string => selectedDomain(c.descriptor.catalogId, key, true);
	return Object.freeze<Storage['importPresets']>({
		get: key => c.send('settings', () => ({ operation: 'get', domain: domain(key) }), clone),
		readEntry: key => c.send('settings', () => ({ operation: 'read-entry', domain: domain(key) }), entry),
		putIfAbsent: (key, value) => c.send('settings', () => ({ operation: 'put-if-absent', domain: domain(key), value: clone(value) }), bool, undefined, false, ACK),
		replaceIfCurrent: (key, expected, replacement) => c.send('settings', () => ({ operation: 'replace-if-current', domain: domain(key), expected: clone(expected), replacement: clone(replacement) }), bool, undefined, false, ACK),
	});
}
function selectedDomain(catalog: string, key: unknown, anchor: boolean): string {
	if (anchor) { if (key !== photoImportPresetsKeyV1(catalog)) throw new TypeError('Fixed import-preset key required.'); return 'import-presets'; }
	const keys = [[photoImportIntentKeyV1(catalog), 'import-intent'], [photoDevelopPresetsKeyV1(catalog), 'develop-presets'], [photoExportPresetsKeyV1(catalog), 'export-presets'], [photoRasterExportJournalKeyV1(catalog), 'export-journal']] as const;
	const selected = keys.find(pair => pair[0] === key); if (!selected) throw new TypeError('Unsupported selected settings domain.'); return selected[1];
}
function entry(value: unknown): Readonly<{ present: false }> | Readonly<{ present: true; value: unknown }> {
	const input = record(value, 'desktop settings entry', ['present', 'value'], ['present']);
	if (field(input, 'present', 'settings entry') === false) { record(value, 'absent settings entry', ['present']); return Object.freeze({ present: false }); }
	if (field(input, 'present', 'settings entry') !== true || !Object.hasOwn(input, 'value')) throw new TypeError('Invalid settings presence reply.');
	return Object.freeze({ present: true, value: clone(field(input, 'value', 'settings entry')) });
}
