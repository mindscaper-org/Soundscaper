/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stable through command publications, and retired by every project activation. */
export function editorProjectEditSessionKey(controller: unknown, projectId: unknown): string {
	const id = typeof projectId === 'string' ? projectId : null;
	if (!isRecord(controller) || typeof controller.captureProjectGeneration !== 'function') {
		return JSON.stringify([id, null]);
	}
	try {
		const token: unknown = Reflect.apply(controller.captureProjectGeneration, controller, [id]);
		if (isRecord(token) && token.projectId === id && typeof token.generation === 'number'
			&& Number.isSafeInteger(token.generation) && token.generation >= 0) {
			return JSON.stringify([id, token.generation]);
		}
	} catch {
		// An outgoing projection may render while its controller activation retires.
	}
	return JSON.stringify([id, 'inactive']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
