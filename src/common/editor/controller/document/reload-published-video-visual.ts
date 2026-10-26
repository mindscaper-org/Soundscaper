/* SPDX-License-Identifier: AGPL-3.0-only */

interface VideoVisualReloadRuntime<Source, Visual> {
	findSource(sourceId: string): Source | null | undefined;
	revoke(sourceId: string): PromiseLike<unknown>;
	activate(source: Source): PromiseLike<Visual>;
	publish(): void;
}

/** Resource replacement must notify views before another transport event can use its retired URL. */
export async function reloadPublishedVideoVisual<Source extends Readonly<{ id: string; kind?: string }>, Visual>(
	sourceId: string,
	runtime: VideoVisualReloadRuntime<Source, Visual>,
): Promise<Visual> {
	const source = runtime.findSource(sourceId);
	if (!source || source.kind !== 'video') throw new ReferenceError(`Video source ${String(sourceId)} is missing.`);
	try {
		await runtime.revoke(source.id);
		return await runtime.activate(source);
	} finally {
		runtime.publish();
	}
}
