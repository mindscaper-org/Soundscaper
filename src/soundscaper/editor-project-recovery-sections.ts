/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
type Admission = (path: string, update: (draft: DataRecord) => void, relationships?: boolean, reportFailure?: boolean) => boolean;
const ALTERNATIVES = ['subprojects', 'trackPlaylists', 'sessionSnapshots'] as const;

/** Restore independent fields when one damaged field keeps a complete section from being admitted. */
export function restoreRecoveryRecord(section: 'metadata' | 'master', value: unknown, attempt: Admission): void {
	const saved = record(value);
	const base = saved && { ...saved };
	if (section === 'metadata' && base) for (const key of ALTERNATIVES) delete base[key];
	if (attempt(section, draft => { draft[section] = base ?? value; }, false, !base) || !base) return;
	for (const [key, field] of Object.entries(base)) {
		attempt(`${section}.${key}`, draft => { draft[section] = { ...record(draft[section]), [key]: field }; });
	}
}

/** Alternatives can only be validated after their source inventory and timeline owners exist. */
export function restoreSoundscaperRecoveryAlternatives(value: unknown, attempt: Admission): void {
	const saved = record(value);
	if (!saved) return;
	for (const key of ALTERNATIVES) {
		if (!Object.hasOwn(saved, key)) continue;
		const entries = saved[key];
		const path = `metadata.${key}`;
		const install = (draft: DataRecord, value: unknown): void => { draft.metadata = { ...record(draft.metadata), [key]: value }; };
		if (attempt(path, draft => { install(draft, entries); }, false, !Array.isArray(entries)) || !Array.isArray(entries)) continue;
		for (const [index, entry] of entries.entries()) {
			const entryPath = `${path}[${String(index)}]`;
			const append = (draft: DataRecord, entry: unknown): void => {
				const current = record(draft.metadata)?.[key];
				install(draft, [...(Array.isArray(current) ? current : []), entry]);
			};
			const collection = key === 'trackPlaylists' ? record(entry) : null;
			const playlists: readonly unknown[] | null = Array.isArray(collection?.playlists) ? collection.playlists : null;
			const active = playlists?.findIndex(playlist => record(playlist)?.id === collection?.activeId) ?? -1;
			const partial = collection !== null && playlists !== null && active >= 0;
			if (attempt(entryPath, draft => { append(draft, entry); }, false, !partial) || !partial) continue;
			const accepted = new Set([active]);
			if (!attempt(entryPath, draft => { append(draft, { ...collection, playlists: [playlists[active]] }); })) continue;
			for (const [playlistIndex] of playlists.entries()) {
				if (playlistIndex === active) continue;
				const surviving = playlists.filter((_, index) => accepted.has(index) || index === playlistIndex);
				if (attempt(`${entryPath}.playlists[${String(playlistIndex)}]`, draft => {
					const current = record(draft.metadata)?.[key] as unknown[];
					install(draft, [...current.slice(0, -1), { ...collection, playlists: surviving }]);
				})) accepted.add(playlistIndex);
			}
		}
	}
}

/** Restore surviving sequence clocks before any track is admitted. */
export function restoreSoundscaperRecoverySequences(raw: DataRecord, attempt: Admission): void {
	const rows: readonly unknown[] = Array.isArray(raw.sequences) ? raw.sequences : [];
	const empty = rows.map(value => {
		const sequence = record(value);
		return sequence ? { ...sequence, trackIds: [], trackNodes: [] } : value;
	});
	if (attempt('sequences', draft => { draft.sequences = empty; draft.primarySequenceId = raw.primarySequenceId; }, false, empty.length === 0)) return;
	let restored = false;
	for (const [index, sequence] of empty.entries()) {
		if (attempt(`sequences[${String(index)}]`, draft => {
			draft.sequences = restored ? [...(draft.sequences as unknown[]), sequence] : [sequence];
			if (!restored || record(sequence)?.id === raw.primarySequenceId) draft.primarySequenceId = record(sequence)?.id;
		})) restored = true;
	}
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}
