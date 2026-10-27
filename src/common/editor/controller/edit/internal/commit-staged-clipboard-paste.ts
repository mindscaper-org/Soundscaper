/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ClipboardPasteBodyStage {
	complete(): void;
	rollback(): PromiseLike<void> | void;
}

/** Publish a complete paste only after its product-owned media bodies are authenticated. */
export function commitStagedClipboardPaste(request: Readonly<{
	stage?: () => PromiseLike<ClipboardPasteBodyStage | null> | ClipboardPasteBodyStage | null;
	assertCurrent: () => void;
	commit: () => unknown;
}>): unknown {
	if (!request.stage) return request.commit();
	const pending = request.stage();
	if (!pending) return request.commit();
	return finish(pending);

	async function finish(pendingStage: PromiseLike<ClipboardPasteBodyStage | null> | ClipboardPasteBodyStage): Promise<unknown> {
		const stage = await pendingStage;
		try {
			request.assertCurrent();
			const result = await request.commit();
			stage?.complete();
			return result;
		} catch (error) {
			try { await stage?.rollback(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Clipboard paste publication and media rollback both failed.', { cause: cleanup }); }
			throw error;
		}
	}
}
