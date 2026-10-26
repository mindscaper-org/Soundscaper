/* SPDX-License-Identifier: AGPL-3.0-only */

/** One synchronous prune owns keys only; no PCM or history records enter the partition. */
export function createMemorySourceChunkKeyReader(chunks: ReadonlyMap<string, unknown>) {
	let keysByToken: Map<unknown, string[]> | null = null;
	return (token: unknown): readonly string[] => {
		if (!token) return [];
		if (!keysByToken) {
			keysByToken = new Map();
			for (const [key, value] of chunks) {
				const storedToken = value && typeof value === 'object' && 'sourceToken' in value ? value.sourceToken : undefined;
				if (!storedToken) continue;
				const keys = keysByToken.get(storedToken);
				if (keys) keys.push(key);
				else keysByToken.set(storedToken, [key]);
			}
		}
		return keysByToken.get(token) ?? [];
	};
}
