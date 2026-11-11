/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useRef, useState } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { selectAudioEditorEditBlock } from '../../edit-blocking.ts';
import { effectMacroMissingEmbeddedNoiseProfile } from '../../effect-macro-templates.ts';
import { macroScriptIsRunnable } from '../../macro-script-library.ts';
import { createMacroAudioInputResolver } from '../../controller/effects/macro-audio-input-service.ts';
import { macroStartsWithCommand } from '../inspector/macro-run-target.ts';
import { publishedCopyFor } from '../../controller/shared/presentation-localization.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import { WorkspacePanelOverlayPortal } from './WorkspacePanelOverlayPortal.tsx';
import MacrosPalettePanel from './MacrosPalettePanel.tsx';

const MacroManager = lazyEditorModule(() => import('../inspector/AudioEditorMacroManagerDialog.jsx'));
const MacroFileBatchDialog = lazyEditorModule(() => import('../dialogs/MacroFileBatchDialog.tsx'));

export default function MacrosPaletteWorkspacePanel(props) {
	return <PaletteSession key={editorProjectEditSessionKey(props.controller, props.snapshot.project?.id)} {...props} />;
}

function PaletteSession({ controller, snapshot, copy, locale, fileService, run }) {
	const host = useRef(null);
	const [manager, setManager] = useState(null);
	const [draft, setDraft] = useState(null);
	const [batch, setBatch] = useState(null);
	const macros = snapshot.macros?.library || [];
	const scripts = snapshot.macros?.scripts || [];
	const blocked = !snapshot.project || selectAudioEditorEditBlock(snapshot).blocked;
	const libraryReadOnly = Boolean(snapshot.readOnly);
	const entries = [
		...macros.map((macro) => ({ id: macro.id, name: macro.name, kind: 'steps',
			runnable: !blocked && macro.effects.length > 0 && !effectMacroMissingEmbeddedNoiseProfile(macro.effects)
				&& (Boolean(snapshot.selection || snapshot.selectedClipId) || macroStartsWithCommand(macro.effects)) })),
		...scripts.map((script) => ({ id: script.id, name: script.name, kind: 'script', runnable: !blocked && macroScriptIsRunnable(script) })),
	];
	const manage = (entry) => {
		setDraft(entry?.kind === 'steps' ? macros.find((macro) => macro.id === entry.id) : null);
		setManager({ scriptId: entry?.kind === 'script' ? entry.id : null });
	};
	return <div ref={host}>
		<MacrosPalettePanel entries={entries} copy={copy} libraryReadOnly={libraryReadOnly}
			onManage={manage}
			onCreate={() => run(() => {
				const created = controller.actions.macros.library.save({ name: publishedCopyFor(copy).untitledMacro, effects: [] });
				if (!created) return;
				setDraft(created);
				setManager({ scriptId: null });
			})}
			onDelete={(entry) => run(() => entry.kind === 'script'
				? controller.actions.macros.scripts.delete(entry.id) : controller.actions.macros.library.delete(entry.id))}
			onRun={(entry) => run(() => {
				if (!entry.runnable) return;
				if (entry.kind === 'steps') return controller.actions.macros.run(macros.find((macro) => macro.id === entry.id));
				const script = scripts.find((candidate) => candidate.id === entry.id);
				if (!script) return;
				return controller.actions.macros.runScript({ name: script.name, source: script.source,
					...(fileService?.isDesktop ? { resolveAudioInput: createMacroAudioInputResolver(fileService,
						(bytes, sampleRate) => controller.engine.decodeAudioData(bytes, { sampleRate })) } : {}) });
			})} />
		<WorkspacePanelOverlayPortal target={host.current?.closest('[data-audio-editor]')}>
			<Suspense fallback={<p role="status">{copy.loading}</p>}>
				{manager && <MacroManager isOpen productId={snapshot.productId} controller={controller} snapshot={snapshot}
					copy={copy} locale={locale} fileService={fileService} draft={draft} onDraftChange={setDraft}
					initialScriptId={manager.scriptId} onClose={() => setManager(null)}
					onApplyToFiles={(macro) => { setManager(null); setBatch(macro); }} />}
				{batch && <MacroFileBatchDialog controller={controller} snapshot={snapshot} copy={copy} fileService={fileService}
					initialMacro={batch} onClose={() => setBatch(null)} />}
			</Suspense>
		</WorkspacePanelOverlayPortal>
	</div>;
}
