/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { usePhotoLibraryRestore } from '../src/common/editor/ui/lightscaper/use-photo-library-restore.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

test('Lightscaper native File retirement joins the actual Restore runtime close after hook cleanup clears its owner', async () => {
	const close = deferred<void>(); let closing = false, joined = false;
	let api!: ReturnType<typeof usePhotoLibraryRestore>;
	const receipt = { catalogId: 'restored', catalogName: 'Restored', photoCount: 0, stackCount: 0,
		savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] };
	function Capture() {
		api = usePhotoLibraryRestore({ retireAndJoin: async () => undefined, onSettled: () => undefined,
			loadRuntime: async () => ({ restoreArchive: async () => receipt,
				close: async () => { closing = true; await close.promise; } }) });
		return null;
	}
	const m = await mountPhotoImportUi(() => <Capture />);
	const retire = api.retireAndJoin;
	try {
		await act(async () => { assert.deepEqual(await api.restore(new File(['backup'], 'Owned.liscape')), receipt); });
		assert.equal(api.isPending(), false);
		await m.dispose(); assert.equal(closing, true);
		const retirement = retire().then(() => { joined = true; });
		await settle(); assert.equal(joined, false);
		close.resolve(); await retirement; assert.equal(joined, true);
	} finally { close.resolve(); await retire(); }
});
