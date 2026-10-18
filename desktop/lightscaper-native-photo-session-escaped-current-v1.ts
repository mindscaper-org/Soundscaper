/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MediaAssetWriter as Writer, OwnedMediaAssetPublication as Publication } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { PhotoSmartCollectionArchiveCaptureV1 as Archive } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import type { PhotoSmartCollectionV1 as Definition } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import type { LightscaperNativePhotoSessionCallsCurrentV1 as Calls } from './lightscaper-native-photo-session-calls-current-v1.ts';

export function captureLightscaperNativePhotoSessionWriterCurrentV1(actual: Writer, calls: Calls): Writer {
	const write = actual.write, commit = actual.commit, commitOwned = actual.commitOwned, abort = actual.abort;
	let retiring: Promise<void> | undefined;
	const retire = (): Promise<void> => retiring ??= calls.run(async () => { await Reflect.apply(abort, actual, []); forget(); }, true);
	const forget = calls.own(retire);
	return Object.freeze({ maximumChunkBytes: actual.maximumChunkBytes, get bytesWritten() { return actual.bytesWritten; },
		write: (...args: Parameters<Writer['write']>) => calls.run(() => Reflect.apply(write, actual, args) as Promise<void>),
		commit: (...args: Parameters<Writer['commit']>) => calls.run(async () => {
			const receipt = await Reflect.apply(commit, actual, args); forget(); return receipt;
		}),
		...(commitOwned ? { commitOwned: (...args: Parameters<NonNullable<Writer['commitOwned']>>) => calls.run(async () => {
			const owned = await Reflect.apply(commitOwned, actual, args) as Publication, discard = owned.discardIfCurrent; forget();
			return Object.freeze({ metadata: owned.metadata, discardIfCurrent: () => calls.run(() => Reflect.apply(discard, owned, []) as Promise<boolean>, true) });
		}) } : {}), abort: retire,
	});
}

export function captureLightscaperNativePhotoSessionArchiveCurrentV1(actual: Archive, calls: Calls): Archive {
	const source = actual.definitions, iterator = source[Symbol.asyncIterator](), next = iterator.next, end = iterator.return, verify = actual.verify;
	let claimed = false, retiring: Promise<IteratorResult<Definition>> | undefined;
	const retire = (): Promise<IteratorResult<Definition>> => retiring ??= calls.run(async () => {
		const result = end ? await Reflect.apply(end, iterator, []) as IteratorResult<Definition> : { done: true as const, value: undefined };
		forget(); return result;
	}, true);
	const forget = calls.own(retire);
	return Object.freeze({ context: actual.context, definitions: Object.freeze({
		[Symbol.asyncIterator](): AsyncIterator<Definition> {
			return calls.sync(() => {
				if (claimed) throw new TypeError('Native Session archive source can only be consumed once.'); claimed = true;
				return Object.freeze({ next: () => calls.run(() => Reflect.apply(next, iterator, []) as ReturnType<typeof next>),
					return: retire as NonNullable<typeof iterator.return> });
			});
		},
	}), verify: () => calls.run(async () => { await Reflect.apply(verify, actual, []); forget(); }) });
}
