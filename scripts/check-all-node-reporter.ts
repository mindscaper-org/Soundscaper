/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendFileSync } from 'node:fs';
import type { TestEvent } from 'node:test/reporters';
import { inspect } from 'node:util';

import { progressRecord } from './lib/check-all-output.ts';
import { REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV, requiredLinuxNativeSkipDetail } from './lib/required-linux-native-tests.mjs';

/** Declaration-ordered test:fail can wait behind a slow sibling; complete cannot. */
export default async function* checkAllNodeReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
	for await (const event of source) {
		const report = process.env[REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV];
		const skipped = requiredLinuxNativeSkipDetail(event);
		if (report && skipped !== null) appendFileSync(report, `${skipped}\n`, { encoding: 'utf8', mode: 0o600 });
		if (event.type === 'test:dequeue') {
			const data = event.data;
			yield progressRecord({ type: 'start', id: JSON.stringify([data.file, data.testId]), label: data.name });
		} else if (event.type === 'test:complete') {
			const data = event.data;
			yield progressRecord({
				type: 'end', id: JSON.stringify([data.file, data.testId]),
				...(!data.details.passed && !data.skip && !data.todo ? {
					failure: `${data.name} (${data.file ?? ''}:${data.line ?? ''})\n${inspect(data.details.error, { depth: 8, colors: false })}`,
				} : {}),
			});
		} else if (event.type === 'test:stdout' || event.type === 'test:stderr') {
			// Keep test diagnostics in the shard log, without a per-result report.
			yield event.data.message;
		}
	}
}
