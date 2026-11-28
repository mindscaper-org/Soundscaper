/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionProjectService } from './tracktion-project-service.ts';

export const TRACKTION_PROJECT_REQUEST = 'soundscaper-tracktion:project-request';
export const TRACKTION_PROJECT_LOST = 'soundscaper-tracktion:project-lost';

/** Use the shell's current-window and main-document IPC handler. */
export function registerTracktionProjectIpc(options: {
	readonly handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => void;
	readonly ownerFor: (event: unknown) => object;
	readonly service: TracktionProjectService;
}) {
	options.handle(TRACKTION_PROJECT_REQUEST, (event, value) => options.service.request(options.ownerFor(event), value));
}
