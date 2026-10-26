/* SPDX-License-Identifier: AGPL-3.0-only */

import { bindFramescaperCorridorKeyRuntime } from '../common/editor/ui/framescaper-corridorkey-runtime.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type { CorridorKeyController } from './editor-corridorkey-workflow.ts';

/** Keep all frame decoding, model custody and source publication behind the menu action. */
export function bindFramescaperCorridorKeyController(controller: CorridorKeyController,
	store: AudioEditorProjectStore): void {
	let active = false;
	bindFramescaperCorridorKeyRuntime(controller, { async run(request) {
		if (active) throw new Error('CorridorKey is already processing a video.');
		active = true;
		try {
			const module = await import('./editor-corridorkey-workflow.ts');
			request.signal?.throwIfAborted();
			return await module.runFramescaperCorridorKey(controller, store, request);
		} finally { active = false; }
	} });
}
