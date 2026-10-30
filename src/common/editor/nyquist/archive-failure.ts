/* SPDX-License-Identifier: AGPL-3.0-only */
export type NyquistArchiveFailureReason = 'downloadHttp' | 'downloadFailed' | 'tooLarge' | 'missingBody' | 'integrity' | 'invalidCatalog' | 'unsupportedPlugin' | 'storageUnavailable' | 'storageQuota' | 'storageFailed';
export interface NyquistArchiveFailure { readonly reason: NyquistArchiveFailureReason; readonly status?: number }
const failures = new WeakMap<Error, NyquistArchiveFailure>();
export function withNyquistArchiveFailure(error: unknown, reason: NyquistArchiveFailureReason, status?: number): Error {
	const diagnostic = error instanceof Error ? error : new Error(String(error));
	if (!failures.has(diagnostic)) failures.set(diagnostic, Object.freeze({ reason, ...(status === undefined ? {} : { status }) }));
	return diagnostic;
}
export function nyquistArchiveFailure(error: unknown): NyquistArchiveFailure | undefined { return error instanceof Error ? failures.get(error) : undefined; }
export async function fetchNyquistArchiveResponse(fetchImpl: typeof fetch, url: string, options: RequestInit): Promise<Response> {
	try { return await fetchImpl(url, options); } catch (error) { throw withNyquistArchiveFailure(error, 'downloadFailed'); }
}
export function writeNyquistArchiveStorage(storage: Pick<Storage, 'setItem'>, key: string, value: string): void {
	try { storage.setItem(key, value); } catch (error) { throw withNyquistArchiveFailure(error, error instanceof Error && error.name === 'QuotaExceededError' ? 'storageQuota' : 'storageFailed'); }
}
