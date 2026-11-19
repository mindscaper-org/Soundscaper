/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../media/indexeddb.ts';
import { RECORDING_ROUTING_SETTING_PREFIX } from '../recording-routing.js';
import { AUDIO_ANALYSIS_REPORT_CACHE_PREFIX, SOURCE_ANALYSIS_CACHE_PREFIXES } from '../source-analysis-cache.ts';
import type { LocalStoreClearOptions } from './linked-original-clear-admission.ts';
import type { EditorMemoryDatabase } from './memory-backend.ts';
import { PROJECT_WRITE_FENCE_SETTING_PREFIX } from './project-write-fence-key.ts';
import { RETENTION_SESSION_SETTING_PREFIX, type RetentionSessionGuard } from './retention-session-guard.ts';
import { EditorStoreClearInUseError } from './status.ts';
import { TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX } from './transient-analysis-cache-repository.ts';
import { TRANSIENT_ANALYSIS_CACHE_KEY_PREFIX } from './transient-analysis-cache.ts';

const ANALYSIS_CACHE_PREFIXES = [
	...SOURCE_ANALYSIS_CACHE_PREFIXES,
	AUDIO_ANALYSIS_REPORT_CACHE_PREFIX,
	TRANSIENT_ANALYSIS_CACHE_KEY_PREFIX,
	TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX,
];

/** Desktop libraries retain projects, including media and recovery state owned by the renderer. */
export async function clearRetainedProjectLocalState(
	database: IDBDatabase | null,
	memory: EditorMemoryDatabase,
	sessionGuard: RetentionSessionGuard | undefined,
	options: Required<LocalStoreClearOptions>,
): Promise<void> {
	const preservedSettings = new Set<IDBValidKey>(options.preserveSettings);
	const preservedPrefixes = [
		PROJECT_WRITE_FENCE_SETTING_PREFIX,
		RECORDING_ROUTING_SETTING_PREFIX,
		RETENTION_SESSION_SETTING_PREFIX,
		...options.preserveSettingPrefixes,
	];
	const clearSetting = (key: IDBValidKey) => !preservedSettings.has(key) && !matchesPrefix(key, preservedPrefixes);
	const clearAnalysisCache = (key: IDBValidKey) => matchesPrefix(key, ANALYSIS_CACHE_PREFIXES);
	if (!database) {
		if (sessionGuard?.hasOtherMemorySession()) throw new EditorStoreClearInUseError();
		for (const key of memory.settings.keys()) if (clearSetting(key)) memory.settings.delete(key);
		for (const key of memory.analysis.keys()) if (clearAnalysisCache(key)) memory.analysis.delete(key);
		return;
	}
	await sessionGuard?.reclaimStoppedSessions(database);
	await transact(database, ['settings', 'analysis'], 'readwrite', async ({ settings, analysis }) => {
		const retainedSessions = await sessionGuard?.retainedSessionRecords(settings) ?? [];
		if (retainedSessions.length > 1) throw new EditorStoreClearInUseError();
		const [settingKeys, analysisKeys] = await Promise.all([request(settings.getAllKeys()), request(analysis.getAllKeys())]);
		for (const key of settingKeys) if (clearSetting(key)) settings.delete(key);
		for (const key of analysisKeys) if (clearAnalysisCache(key)) analysis.delete(key);
	});
}

function matchesPrefix(key: IDBValidKey, prefixes: readonly string[]): boolean {
	return typeof key === 'string' && prefixes.some(prefix => key.startsWith(prefix));
}
