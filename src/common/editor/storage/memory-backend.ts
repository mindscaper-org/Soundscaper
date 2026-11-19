/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EditorMemoryDatabase {
	readonly projects: Map<string, unknown>;
	readonly revisions: Map<string, unknown>;
	readonly settings: Map<string, unknown>;
	readonly analysis: Map<string, unknown>;
	readonly sources: Map<string, unknown>;
	readonly sourceChunks: Map<string, unknown>;
	readonly mediaAssets: Map<string, unknown>;
	readonly mediaAssetChunks: Map<string, unknown>;
	readonly mediaAssetStaging: Map<string, unknown>;
	readonly videoDerivatives: Map<string, unknown>;
	readonly linkedVideoOriginalBindings: Map<string, unknown>;
	readonly linkedOriginalProvisionalRoots: Map<string, unknown>;
}

const memoryDatabases = new Map<string, EditorMemoryDatabase>();

/** A temporary worker/controller never enters the shared degraded-library registry. */
export function storeMemoryDatabase(name: string, options: Readonly<{ ephemeralMemory?: boolean; indexedDB?: unknown; preferOpfs?: boolean }>): EditorMemoryDatabase {
	if (!options.ephemeralMemory) return getMemoryDatabase(name);
	if (options.indexedDB !== null || options.preferOpfs !== false) throw new TypeError('Ephemeral storage requires explicit memory-only backends.');
	return emptyMemoryDatabase();
}

function emptyMemoryDatabase(): EditorMemoryDatabase {
	return { projects: new Map(), revisions: new Map(), settings: new Map(), analysis: new Map(), sources: new Map(), sourceChunks: new Map(),
		mediaAssets: new Map(), mediaAssetChunks: new Map(), mediaAssetStaging: new Map(), videoDerivatives: new Map(),
		linkedVideoOriginalBindings: new Map(), linkedOriginalProvisionalRoots: new Map() };
}

/**
 * Process-local degraded backend. Its module-scoped registry intentionally
 * mirrors IndexedDB database-name isolation without claiming durability.
 */
export function getMemoryDatabase(name: string): EditorMemoryDatabase {
	let database = memoryDatabases.get(name);
	if (!database) {
		database = emptyMemoryDatabase();
		memoryDatabases.set(name, database);
	}
	return database;
}
