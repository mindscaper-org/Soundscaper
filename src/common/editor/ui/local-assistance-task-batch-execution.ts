/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalAssistanceBridge } from '../assistance/local-assistance-bridge.ts';
import type { LocalAssistanceAudioEffectBatch, LocalAssistanceAudioEffectWorkflowId } from
	'../assistance/local-assistance-preparation.ts';
import type { AssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import { createLocalAssistanceGuidedSessionStore, INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT,
	type LocalAssistanceGuidedSessionStore, type LocalAssistanceGuidedSnapshot } from './local-assistance-guided-session-store.ts';
import { executeLocalAssistanceTask } from './local-assistance-task-execution.ts';

type SessionOptions = Parameters<typeof createLocalAssistanceGuidedSessionStore>[0];
interface Options {
	readonly batch: LocalAssistanceAudioEffectBatch;
	readonly bridge: Pick<LocalAssistanceBridge, 'models' | 'workflow'> | null;
	readonly workflowId: LocalAssistanceAudioEffectWorkflowId;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly signal: AbortSignal;
	readonly onSnapshot: (snapshot: LocalAssistanceGuidedSnapshot) => void;
	readonly createSession?: (options: SessionOptions) => LocalAssistanceGuidedSessionStore;
}

/** Authenticate each occurrence against the captured selection; publish only after all succeed. */
export async function executeLocalAssistanceTaskBatch(options: Options): Promise<LocalAssistanceGuidedSnapshot> {
	let current: LocalAssistanceGuidedSessionStore | null = null;
	let last = INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT;
	const cancel = (): void => {
		void current?.dispose().catch(() => undefined);
		void options.batch.dispose().catch(() => undefined);
	};
	options.signal.addEventListener('abort', cancel, { once: true });
	try {
		options.signal.throwIfAborted();
		if (options.batch.preparations.length === 0) throw new Error('Select audio in the timeline first.');
		for (const preparation of options.batch.preparations) {
			options.signal.throwIfAborted();
			const session = (options.createSession ?? createLocalAssistanceGuidedSessionStore)({
				bridge: options.bridge, preparation,
			});
			current = session;
			session.selectWorkflow(options.workflowId);
			session.setSettings(options.settings);
			const disconnect = session.subscribe(() => {
				const snapshot = session.getSnapshot();
				// Child acceptance stages sources; only batch.commit publishes the document.
				options.onSnapshot(snapshot.phase === 'accepted'
					? { ...snapshot, phase: 'preparing', canRun: false, canAccept: false, canCancel: true }
					: snapshot);
			});
			try {
				await executeLocalAssistanceTask(session, options.workflowId);
				last = session.getSnapshot();
			} finally {
				disconnect();
				await session.dispose();
				current = null;
			}
			options.signal.throwIfAborted();
			if (last.error) return { ...last, phase: 'error', canRun: false, canAccept: false };
			if (last.phase !== 'accepted') return last;
		}
		options.signal.throwIfAborted();
		await options.batch.commit();
		return last;
	} finally {
		options.signal.removeEventListener('abort', cancel);
		await options.batch.dispose();
	}
}
