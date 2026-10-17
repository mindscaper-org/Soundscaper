/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudiocomProjectArchiveOptions } from '../audiocom-project-archives.ts';

/** Persist only identifiers; the server must confirm ownership after reconnecting. */
export function projectBindings(options: AudiocomProjectArchiveOptions) {
	const key = `soundscaper:audiocom-projects:${options.apiOrigin ?? 'https://api.audio.com'}`;
	let storage: AudiocomProjectArchiveOptions['revisionStorage'];
	const bindings = new Map<string, string>();
	try {
		storage = options.revisionStorage === undefined ? globalThis.window?.localStorage : options.revisionStorage;
		const saved: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
		if (Array.isArray(saved)) for (const entry of saved) {
			if (Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string')) bindings.set(String(entry[0]), String(entry[1]));
		}
	} catch { /* Storage restrictions must not prevent an in-session save. */ }
	return {
		get: (projectId: string) => bindings.get(projectId),
		set(projectId: string, cloudId: string): void {
			bindings.set(projectId, cloudId);
			try { storage?.setItem(key, JSON.stringify([...bindings])); } catch { /* Keep the in-session binding. */ }
		},
	};
}
