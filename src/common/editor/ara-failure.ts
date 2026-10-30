/* SPDX-License-Identifier: AGPL-3.0-only */
export const ARA_FAILURE_CODES = Object.freeze(['unsupported-plugin', 'unavailable', 'revoked', 'closed', 'selection-changed',
	'cancelled', 'open-failed', 'editor-failed', 'render-failed', 'discovery-failed', 'operation-failed'] as const);
export type AraFailureCode = typeof ARA_FAILURE_CODES[number];
const CODES: ReadonlySet<string> = new Set(ARA_FAILURE_CODES);
/** Electron retains Error.message, so this bounded machine tag also survives main/preload serialization. */
export class AraOperationError extends Error {
	constructor(readonly araCode: AraFailureCode, readonly diagnostic: string) {
		super(`[SCAPE_ARA:${araCode}] ${diagnostic}`); this.name = 'AraOperationError';
	}
}
export function araFailureInfo(error: unknown, fallback: AraFailureCode = 'operation-failed'): Readonly<{ code: AraFailureCode; diagnostic: string }> {
	if (error instanceof AraOperationError) return { code: error.araCode, diagnostic: error.diagnostic };
	const diagnostic = error instanceof Error ? error.message : String(error);
	const encoded = /\[SCAPE_ARA:([a-z-]+)\] ([\s\S]*)/u.exec(diagnostic);
	return encoded && CODES.has(encoded[1]!) ? { code: encoded[1] as AraFailureCode, diagnostic: encoded[2]! } : { code: fallback, diagnostic };
}
