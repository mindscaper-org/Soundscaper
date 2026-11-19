/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActionRuntime } from './action-facade.ts';
import { createSubprojectActionComposition } from './internal/subproject-action-composition.ts';
import type { createControllerBindings } from './controller-bindings.ts';
import { guardEditorControllerActions } from './internal/controller-action-guard.ts';

type Bindings = ReturnType<typeof createControllerBindings>;
type BoundAction = keyof Bindings & keyof EditorActionRuntime;

/** Owner bindings supply the common operations; explicit overrides keep product fences. */
export type ControllerActionContext = Omit<EditorActionRuntime, BoundAction>
	& Partial<Pick<EditorActionRuntime, BoundAction>>;

export function createControllerActionComposition(
	bindings: Bindings,
	context: ControllerActionContext,
	assertActive: () => void,
) {
	return guardEditorControllerActions(createSubprojectActionComposition({
		...bindings,
		...context,
	}, bindings), assertActive);
}
