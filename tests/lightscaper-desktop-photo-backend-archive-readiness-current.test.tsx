/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode, useRef } from 'react';
import { LightscaperPhotoBackendSwitchCurrentV1 as Switch } from '../src/common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import { LightscaperPhotoBackendContextCurrentV1 as Context } from '../src/common/editor/ui/lightscaper/photo-library-backend-context-current-v1.ts';
import PhotoLibraryBackendMenuCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoLibraryBackendMenuCurrentV1.tsx';
import { useLightscaperDesktopArchiveOpenCurrentV1 } from '../src/common/editor/ui/lightscaper/use-lightscaper-desktop-archive-open-current-v1.ts';
import { useLightscaperDesktopLifecycle } from '../src/common/editor/ui/lightscaper/use-lightscaper-desktop-lifecycle.ts';
import type { DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const outcome of ['empty', 'rejected'] as const) void test(`Native backend choice becomes enabled after the initial ${outcome} archive check without a further user event`, async () => {
	const taking = deferred<DesktopLightscaperArchiveOpenDescriptorCurrentV1 | null>();
	const owner = new Switch({ nativeAvailable: true });
	let takes = 0;
	const errors: unknown[] = [];
	function Workspace() {
		const app = useRef<HTMLElement>(null);
		const archive = useLightscaperDesktopArchiveOpenCurrentV1({ canPresent: () => true,
			onPresent: () => assert.fail('No archive was selected.'), retireRestore: async () => undefined,
			reportError: error => { errors.push(error); }, load: async () => { throw new Error('No archive was selected.'); } });
		useLightscaperDesktopLifecycle({ app, locale: 'en', isCurrent: () => true,
			hasPendingWork: archive.isPending, hasOpenSurface: () => false, fence: () => undefined,
			retireAndJoin: archive.retireAndJoin });
		return <section ref={app}><details name="lightscaper-application-menu"><summary>File</summary>
			<div className="lightscaper-menu-items"><button data-photo-backup-menu>Backup</button>
				<button data-photo-restore-menu>Restore</button></div></details></section>;
	}
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'lightscaperDesktop', { configurable: true, value: { v1: {
			signalReady: async () => undefined, onCloseRequested: () => () => undefined, respondToClose: async () => undefined,
			takeArchive: async () => { takes++; return taking.promise; }, finishArchive: async () => undefined, onArchiveAvailable: () => () => undefined,
		} } });
		return <StrictMode><Context.Provider value={owner}><Workspace /><PhotoLibraryBackendMenuCurrentV1 locale="en" /></Context.Provider></StrictMode>;
	});
	try {
		await act(async () => { await settle(); });
		assert.equal(takes, 1);
		// A normal workspace/menu update can observe the in-flight desktop IPC.
		await mounted.render();
		assert.equal(reactProps(mounted.dom.one('[data-photo-backend-choice="native"]')).disabled, true);
		await act(async () => {
			if (outcome === 'empty') taking.resolve(null); else taking.reject(new Error('Archive check failed.'));
			await settle();
		});
		assert.equal(reactProps(mounted.dom.one('[data-photo-backend-choice="native"]')).disabled, false);
		assert.equal(owner.snapshot().backend, 'web');
		assert.equal(mounted.dom.find('[role="dialog"]'), null);
		assert.equal(errors.length, outcome === 'empty' ? 0 : 1);
	} finally { await act(async () => { taking.resolve(null); await owner.close(); }); await mounted.dispose(); }
});
