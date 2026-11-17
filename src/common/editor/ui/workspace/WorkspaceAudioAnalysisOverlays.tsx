/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentProps } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import type { DialogueAlignmentDialogProps } from '../dialogs/DialogueAlignmentDialog.tsx';
import SubprojectSurface from './SubprojectSurface.tsx';
import type { SubprojectsDialogProps } from '../dialogs/SubprojectsDialog.tsx';
import MicrophoneBleedSurface from './MicrophoneBleedSurface.tsx';

const DialogueAlignmentDialog = lazyEditorModule(() => import('../dialogs/DialogueAlignmentDialog.tsx'));
const AnalysisDialog = lazyEditorModule(() => import('../dialogs/AnalysisDialog.jsx'));
const SessionSnapshotsDialog = lazyEditorModule(() => import('../dialogs/SessionSnapshotsDialog.tsx'));
const TrackPlaylistsDialog = lazyEditorModule(() => import('../dialogs/TrackPlaylistsDialog.tsx'));
type Props = Pick<SubprojectsDialogProps, 'controller'> & ComponentProps<typeof MicrophoneBleedSurface> & Pick<ComponentProps<typeof TrackPlaylistsDialog>, 'controller' | 'snapshot'> & Pick<ComponentProps<typeof SessionSnapshotsDialog>, 'controller'> & Pick<DialogueAlignmentDialogProps, 'controller' | 'snapshot'> & {
	readonly surfaceRequestId?: string | number;
	readonly fileService: unknown;
};

/** Group opt-in audio analysis dialogs without growing the workspace's general overlay owner. */
export default function WorkspaceAudioAnalysisOverlays({ activeSurface, surfaceRequestId, controller, snapshot, copy, fileService, onClose }: Props) {
	return <>
		<SubprojectSurface activeSurface={activeSurface} controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} />
		{activeSurface === 'track-playlists' && <TrackPlaylistsDialog controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} />}
		{activeSurface === 'session-snapshots' && <SessionSnapshotsDialog controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} />}
		{activeSurface?.startsWith('offline-analysis-') && <div data-editor-surface={activeSurface}>
			<AnalysisDialog mode={activeSurface.slice('offline-analysis-'.length)} requestId={surfaceRequestId}
				controller={controller} snapshot={snapshot} copy={copy} fileService={fileService} onClose={onClose} />
		</div>}
		{activeSurface === 'align-dialogue' && <DialogueAlignmentDialog controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} />}
		<MicrophoneBleedSurface activeSurface={activeSurface} controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} />
	</>;
}
