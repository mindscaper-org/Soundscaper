/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef, StrictMode } from 'react';
import { LightscaperPhotoBackendSwitchCurrentV1 as Switch } from '../src/common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import { LightscaperPhotoBackendContextCurrentV1 as Context } from '../src/common/editor/ui/lightscaper/photo-library-backend-context-current-v1.ts';
import PhotoLibraryBackendMenuCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoLibraryBackendMenuCurrentV1.tsx';
import { useLightscaperDesktopLifecycle } from '../src/common/editor/ui/lightscaper/use-lightscaper-desktop-lifecycle.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const locale of ['en', 'de']) void test(`${locale}: backend radios belong only to actual File menu, use keyboard selection, and await existing workspace retirement`, { timeout: 15_000 }, async context => {
 const owner = new Switch({ nativeAvailable: true }), held = deferred<void>(); let fences = 0, closes = 0;
 const cancel = (): void => { held.resolve(); }; context.signal.addEventListener('abort', cancel, { once: true });
 function Workspace() {
  const app = useRef<HTMLElement>(null);
  useLightscaperDesktopLifecycle({ app, locale, isCurrent: () => true, hasPendingWork: () => false, hasOpenSurface: () => false,
   fence: () => { fences++; }, retireAndJoin: async () => { closes++; await held.promise; } });
  return <section ref={app}><nav className="lightscaper-menus"><details name="lightscaper-application-menu" data-test-file-menu><summary>{locale === 'de' ? 'Datei' : 'File'}</summary><div className="lightscaper-menu-items">
   <button data-photo-backup-menu>Backup</button><button data-photo-restore-menu>Restore</button></div></details>
   <details name="lightscaper-application-menu" data-test-view-menu><summary>View</summary><div className="lightscaper-menu-items"><button>View action</button></div></details></nav></section>;
 }
 const mounted = await mountPhotoImportUi(() => <StrictMode><Context.Provider value={owner}><Workspace /><PhotoLibraryBackendMenuCurrentV1 locale={locale} /></Context.Provider></StrictMode>);
 try {
  const file = mounted.dom.one('[data-test-file-menu]'), view = mounted.dom.one('[data-test-view-menu]');
  const menu = mounted.dom.one('[data-photo-backend-menu]'); assert.ok(file.contains(menu)); assert.equal(view.contains(menu), false);
  const web = mounted.dom.one('[data-photo-backend-choice="web"]'), native = mounted.dom.one('[data-photo-backend-choice="native"]');
  assert.equal(web.getAttribute('role'), 'radio'); assert.equal(web.getAttribute('aria-checked'), 'true'); assert.equal(native.getAttribute('aria-checked'), 'false'); assert.equal(closes, 0);
  let prevented = 0;
  await act(async () => { reactProps(web).onKeyDown?.({ key: 'ArrowRight', currentTarget: web, preventDefault() { prevented++; }, stopPropagation() {} }); await settle(); });
  assert.equal(prevented, 1); assert.equal(fences, 1); assert.equal(closes, 1); assert.equal(owner.snapshot().backend, 'web'); assert.equal(owner.snapshot().busy, true);
  await act(async () => { held.resolve(); await settle(); }); assert.equal(owner.snapshot().backend, 'native');
 } finally { held.resolve(); await owner.close(); await mounted.dispose(); context.signal.removeEventListener('abort', cancel); }
});

void test('Absent/incomplete native pair leaves default Web controls and no backend menu affordance', async () => {
 const owner = new Switch({ nativeAvailable: false });
 const mounted = await mountPhotoImportUi(() => <Context.Provider value={owner}><PhotoLibraryBackendMenuCurrentV1 locale="en" /></Context.Provider>);
 try { assert.equal(mounted.dom.find('[data-photo-backend-menu]'), null); assert.equal(owner.snapshot().backend, 'web'); } finally { await owner.close(); await mounted.dispose(); }
});
