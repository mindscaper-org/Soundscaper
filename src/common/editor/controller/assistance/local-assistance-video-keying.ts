/* SPDX-License-Identifier: AGPL-3.0-only */

/** Focused entry point for the menu-owned Framescaper video-keying workflow. */
export { createLocalAssistanceVideoKeyingPublication,
	type LocalAssistanceKeyedVideoInspection, type LocalAssistanceVideoKeyingPublicationDependencies,
	type LocalAssistanceVideoKeyingRun } from './internal/video/local-assistance-video-keying-publication.ts';
export { createLocalAssistanceVideoKeyingWorkflow, CORRIDORKEY_MODEL_ID, CORRIDORKEY_MODEL_VERSION,
	type VideoKeyingProgress, type VideoKeyingWorkflowOptions } from './internal/video/local-assistance-video-keying-workflow.ts';
export { createLocalAssistanceVideoKeyingFramePreparation } from './internal/video/local-assistance-video-keying-frames.ts';
