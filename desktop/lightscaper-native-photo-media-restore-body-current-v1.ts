/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import type { LightscaperNativePhotoOriginalReadRequestCurrentV1 as Request } from './lightscaper-native-photo-original-read-authority-current-v1.ts';
import type { LightscaperNativePhotoMediaOriginalReadCurrentV1 as Lease } from './lightscaper-native-photo-media-original-reads-current-v1.ts';
import { activateLightscaperNativePhotoOriginalReadReservationCurrentV1 as activate } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as MAXIMUM } from './lightscaper-native-original-contract-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { createLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1 as cleanupError } from './lightscaper-native-photo-library-restore-claim-current-v1.ts';

const FILL = Uint8Array.prototype.fill;
/** Actual scalar custody and deletion pin, then bounded authenticated physical
 * reads. The generic media metadata decoder is never part of this body proof.
 * A real first-delivery request authenticates candidate-local alias reuse. */
export async function hashLightscaperNativePhotoMediaRestoreBodyCurrentV1(media: Media, request: Readonly<Request>, signal: AbortSignal): Promise<void> {
	const reservation = media.reserveOriginalRead(); let reader: Readonly<Lease> | undefined, failed = false, primary: unknown;
	try {
		activate(reservation); check(signal); reader = await media.acquireOriginalRead(request, { signal }); check(signal);
		const hash = createHash('sha256'); let offset = 0;
		while (offset < request.original.byteLength) {
			check(signal); const length = Math.min(MAXIMUM, request.original.byteLength - offset), bytes = await reader.read(offset, length, request.importId, reservation);
			try {
				check(signal); if (bytes.byteLength !== length) throw new Error('Native restored body range differs from its exact length.');
				hash.update(bytes); offset += bytes.byteLength;
			} finally { Reflect.apply(FILL, bytes, [0]); }
		}
		if (offset !== request.original.byteLength || hash.digest('hex') !== request.original.contentSha256) throw new Error('Native restored body SHA/length differs.');
		await reader.assertCurrent(request.importId); check(signal);
	} catch (error) { failed = true; primary = error; }
	let cleanupFailed = false, cleanup: unknown;
	try { await reader?.close(); } catch (error) { cleanupFailed = true; cleanup = error; }
	try { reservation.release(); } catch (error) { cleanup = cleanupFailed && !Object.is(cleanup, error) ? cleanupError(cleanup, error, 'Native restore read reservation failed to retire.') : error; cleanupFailed = true; }
	if (cleanupFailed) throw cleanupError(failed ? primary : undefined, cleanup, 'Native restored physical read did not retire.');
	if (failed) throw primary;
}
