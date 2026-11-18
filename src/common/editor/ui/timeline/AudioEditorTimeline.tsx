import { useEffect, useState } from 'react';
import type { EditorController, EditorSnapshot } from '../../types.ts';
import type { TrackAutomationRuntime } from '../../track-automation-runtime.ts';
import type { TrackFreezeRuntime } from '../../track-freeze-runtime.ts';
import type { ClipPropertiesFocus } from './clip-header-actions.ts';
import type { FileSizeWarningConfirmation } from '../../controller/shared/file-size-warning.ts';
import TimelineController from './TimelineController.jsx';
import EditorSurfaceBoundary from '../EditorSurfaceBoundary.jsx';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import type { ProjectTimelineScrollPositions } from './useProjectTimelineScroll.ts';

export interface TrackHeaderDrawer {
	readonly isOpen: boolean;
	toggle(): void;
	close(): void;
}

interface TimelineSearchRevealRequest {
	readonly clipId?: string;
	readonly revision?: number;
	readonly projectIdentity?: string;
}

interface AudioEditorTimelineProps {
	readonly controller: EditorController;
	readonly confirmFileSizeWarning?: FileSizeWarningConfirmation;
	readonly snapshot: EditorSnapshot;
	readonly runtimeProject?: Readonly<Record<string, unknown>> | null;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly mobile: boolean;
	readonly trackHeaderDrawer?: TrackHeaderDrawer | null;
	readonly showArmControls: boolean;
	readonly displayAudioSupported: boolean;
	readonly importRoutedFiles?: (files: readonly File[], options: Readonly<Record<string, unknown>>) => unknown;
	readonly productId: string;
	readonly capabilities: Readonly<Record<string, unknown>>;
	readonly splitToolEnabled?: boolean;
	readonly splitToolMomentary?: boolean;
	readonly automationToolEnabled?: boolean;
	readonly spectralBrushEnabled?: boolean;
	readonly onError: (error: unknown) => void;
	readonly onOpenEffects?: (...args: readonly unknown[]) => void;
	readonly onOpenClipProperties?: (clipId: string, field?: ClipPropertiesFocus) => void;
	readonly onExportClip?: (clipId: string) => void;
	readonly onUploadClipToFreesound?: (clipId: string) => void;
	readonly onRevealProjectBin?: () => void;
	readonly onToggleArmControls?: () => void;
	readonly onOpenSurface?: (surface: string) => void;
	readonly automationRuntime?: Readonly<TrackAutomationRuntime> | null;
	readonly freezeRuntime?: Readonly<TrackFreezeRuntime> | null;
	readonly searchRevealRequest?: TimelineSearchRevealRequest | null;
	readonly overlayTarget?: Element | null;
}

export default function AudioEditorTimeline({
	controller,
	confirmFileSizeWarning,
	snapshot,
	runtimeProject = null,
	locale,
	copy,
	mobile,
	trackHeaderDrawer = null,
	showArmControls,
	displayAudioSupported,
	importRoutedFiles,
	productId,
	capabilities,
	splitToolEnabled = false,
	splitToolMomentary = false,
	automationToolEnabled = false,
	spectralBrushEnabled = false,
	onError,
	onOpenEffects,
	onOpenClipProperties,
	onExportClip,
	onUploadClipToFreesound,
	onRevealProjectBin,
	onToggleArmControls,
	onOpenSurface,
	automationRuntime = null,
	freezeRuntime = null,
	searchRevealRequest = null,
	overlayTarget = null,
}: AudioEditorTimelineProps) {
	const [scrollPositions] = useState<ProjectTimelineScrollPositions>(() => new Map());
	const openTabs: unknown = snapshot.projectTabs;
	useEffect(() => {
		if (!Array.isArray(openTabs)) return;
		const openIds = new Set((openTabs as readonly { id: string }[]).map(tab => tab.id));
		for (const id of scrollPositions.keys()) if (!openIds.has(id)) scrollPositions.delete(id);
	}, [openTabs, scrollPositions]);
	const geometry = { mobile, showArmControls, displayAudioSupported, trackHeaderDrawer };
	const selection = { searchRevealRequest };
	const preview = { overlayTarget };
	const navigation = {
		splitToolEnabled,
		splitToolMomentary,
		automationToolEnabled,
		spectralBrushEnabled,
	};
	const actions = {
		confirmFileSizeWarning,
		importRoutedFiles,
		onError,
		onOpenEffects,
		onOpenClipProperties,
		onExportClip,
		onUploadClipToFreesound,
		onRevealProjectBin,
		onToggleArmControls,
		onOpenSurface,
		automationRuntime,
		freezeRuntime,
		productId,
		capabilities,
	};

	// The timeline re-derives the runtime projection it draws from, so a
	// document the projection refuses fails here, under a boundary the size of
	// the timeline, rather than at the root where it would blank the editor.
	return (
		<EditorSurfaceBoundary copy={copy} surface="timeline" resetKey={snapshot.project}>
			<TimelineController
				key={editorProjectEditSessionKey(controller, snapshot.project?.id)}
				controller={controller}
				snapshot={snapshot}
				runtimeProject={runtimeProject}
				locale={locale}
				copy={copy}
				scrollPositions={scrollPositions}
				geometry={geometry}
				selection={selection}
				preview={preview}
				navigation={navigation}
				actions={actions}
			/>
		</EditorSurfaceBoundary>
	);
}
