/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import type { SubprojectsDialogProps } from '../dialogs/SubprojectsDialog.tsx';
import { selectAudioEditorEditBlock } from '../../edit-blocking.ts';

const SubprojectsDialog = lazyEditorModule(() => import('../dialogs/SubprojectsDialog.tsx'));
type Props = SubprojectsDialogProps & { readonly activeSurface: string | null | undefined };

/** Presentation owns mounting; the controller owns update scheduling and cancellation. */
export default function SubprojectSurface({ activeSurface, controller, snapshot, copy, onClose }: Props) {
	const projectId = snapshot.project?.id;
	const hasLinks = Boolean((snapshot.project?.metadata as { subprojects?: readonly unknown[] } | undefined)?.subprojects?.length);
	const blocked = !snapshot.ready || selectAudioEditorEditBlock(snapshot).blocked;
	useEffect(() => {
		if (!hasLinks || blocked) return;
		const abort = new AbortController();
		void controller.actions.subprojects.watch(abort.signal).catch(() => undefined);
		return () => abort.abort();
	}, [controller, projectId, hasLinks, blocked]);
	return activeSurface === 'subprojects' ? <SubprojectsDialog controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} /> : null;
}
