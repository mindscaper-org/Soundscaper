/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EDITOR_ACTION_FUNCTION_NAMES,
	EditorActionRuntime,
} from '../src/common/editor/controller/composition/action-facade-runtime.ts';
import type { EditorActionFunctions } from '../src/common/editor/controller/composition/editor-action-functions.ts';

type AssertTrue<Value extends true> = Value;

export type EditorActionFunctionInventoryIsExhaustive = AssertTrue<
	Exclude<keyof EditorActionFunctions, typeof EDITOR_ACTION_FUNCTION_NAMES[number]> extends never
		? true
		: false
>;

// The closed assembly must reject misspelled dependency names.
// @ts-expect-error There is no arbitrary-name fallback in the action assembly.
export type MisspelledActionDependency = EditorActionRuntime['saveNwo'];
