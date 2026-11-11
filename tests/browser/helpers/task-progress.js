/* SPDX-License-Identifier: AGPL-3.0-only */

/** Blocking operations expose cancellation in their foreground progress dialog. */
export function taskProgressCancel(page) {
	return page.locator('[data-task-progress-dialog]').getByRole('button', { name: 'Cancel', exact: true });
}
