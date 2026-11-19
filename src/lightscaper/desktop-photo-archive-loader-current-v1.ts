/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';
import type { DesktopPhotoArchiveFileCurrentV1, DesktopPhotoArchiveFileOptionsCurrentV1 } from './desktop-photo-archive-file-current-v1.ts';

interface ArchiveFileRuntime {
	materializeDesktopPhotoArchiveFileCurrentV1(descriptor: unknown, options: DesktopPhotoArchiveFileOptionsCurrentV1): Promise<Readonly<DesktopPhotoArchiveFileCurrentV1>>;
}
interface ArchiveFileLoaderOptions extends Pick<DesktopPhotoArchiveFileOptionsCurrentV1, 'finishArchive' | 'signal'> {
	readonly loadRuntime?: () => Promise<ArchiveFileRuntime>;
}

/** An issued native grant exists before lazy code activation. If activation
 * fails, join its release here; after activation the materializer owns release. */
export async function loadDesktopPhotoArchiveFileCurrentV1(descriptor: Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1>,
	options: ArchiveFileLoaderOptions,
): Promise<Readonly<DesktopPhotoArchiveFileCurrentV1>> {
	let runtime: ArchiveFileRuntime;
	try { runtime = await (options.loadRuntime ? options.loadRuntime() : import('./desktop-photo-archive-file-current-v1.ts')); }
	catch (primary) {
		try { await options.finishArchive(Object.freeze({ id: descriptor.id })); }
		catch (cleanup) { throw new AggregateError([primary, cleanup], 'Photo archive activation and native retirement failed.', { cause: cleanup }); }
		throw primary;
	}
	return runtime.materializeDesktopPhotoArchiveFileCurrentV1(descriptor, options);
}
