/* SPDX-License-Identifier: AGPL-3.0-only */

import { NATIVE_QUEUE_STATES, NATIVE_QUEUE_TASK_KINDS } from '../src/common/editor/native-queue-record.ts';
import { assertNativeMediaRelativeDestination } from '../src/common/editor/native-media-atomic-publication.ts';
import { assertFramescaperNativeQueueProjection, type FramescaperNativeQueueProjection } from './native-services-controller-contracts-v3.ts';

/** Decode exactly the scalar status columns; full plans remain owned by execution and mutations. */
export function nativeQueueStatusProjection(row: Record<string, unknown>): FramescaperNativeQueueProjection {
	const result = { jobId: row.job_id, schemaFamily: row.schema_family, schemaVersion: row.schema_version,
		taskKind: row.task_kind, projectId: row.project_id, relativeDestination: row.relative_destination, state: row.state,
		position: row.position, progress: row.progress, attempt: row.attempt, lastFailureCode: row.last_failure_code };
	assertFramescaperNativeQueueProjection(result);
	if (!(NATIVE_QUEUE_TASK_KINDS as readonly unknown[]).includes(result.taskKind)
		|| !(NATIVE_QUEUE_STATES as readonly unknown[]).includes(result.state)
		|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result.projectId)
		|| result.state === 'failed' && result.lastFailureCode === null
		|| result.lastFailureCode !== null && !/^[a-z][a-z0-9-]{0,63}$/u.test(result.lastFailureCode)) {
		throw new TypeError('Stored native queue status has invalid scalar authority.');
	}
	assertNativeMediaRelativeDestination(result.relativeDestination);
	return Object.freeze(result);
}
