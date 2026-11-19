/* SPDX-License-Identifier: AGPL-3.0-only */

import { acquireLightscaperNativePhotoLibraryWriterCurrentV1 as acquire } from '../../desktop/lightscaper-native-photo-library-writer-current-v1.ts';

export interface NativeLibraryWriterPacketCurrentV1 { readonly status: 'held' | 'released' | 'failed'; readonly message?: string }

const root = process.argv[2];
if (!root || !process.send || !process.disconnect) throw new Error('Native writer child requires its private root and IPC parent.');
const send = (packet: NativeLibraryWriterPacketCurrentV1): void => { process.send!(packet); };
try {
	const guard = await acquire(root); send({ status: 'held' });
	process.on('message', message => {
		if (message !== 'release') return;
		void guard.close().then(() => { send({ status: 'released' }); process.disconnect!(); }, (error: unknown) => {
			send({ status: 'failed', message: error instanceof Error ? error.message : 'Native guard close failed.' }); process.exitCode = 1; process.disconnect!();
		});
	});
} catch (error) {
	send({ status: 'failed', message: error instanceof Error ? error.message : 'Native guard acquire failed.' }); process.exitCode = 1; process.disconnect!();
}
