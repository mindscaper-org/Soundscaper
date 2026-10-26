/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';

export interface NightlyCheckpointTest {
	id: string;
	description: string;
	serialGroup: string | null;
	complete: boolean;
	failed: boolean;
}

export interface NightlyCheckpoint {
	tests: NightlyCheckpointTest[];
	status: FullResult['status'];
}

/** A separate checkpoint is authoritative about logical tests, including retries. */
export default class NightlyTestsCheckpointReporter {
	#tests = new Map<string, NightlyCheckpointTest>();
	#file = process.env.SOUNDSCAPER_NIGHTLY_CHECKPOINT;
	#failOnFlakyTests = false;

	onBegin(config: FullConfig, suite: Suite): void {
		this.#failOnFlakyTests = config.failOnFlakyTests;
		for (const test of suite.allTests()) {
			const [, project, , ...titles] = test.titlePath();
			this.#tests.set(test.id, {
				id: test.id,
				description: `[${project ?? ''}] › ${relative(config.rootDir, test.location.file).replaceAll('\\', '/')} › ${titles.join(' › ')}`,
				serialGroup: serialGroup(test.parent), complete: false, failed: false,
			});
		}
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		const entry = this.#tests.get(test.id);
		if (!entry) return;
		entry.complete = result.status !== 'interrupted'
			&& (result.status !== 'skipped' || test.expectedStatus === 'skipped')
			&& (result.status === test.expectedStatus || result.retry >= test.retries);
		entry.failed = entry.complete && (test.outcome() === 'unexpected'
			|| this.#failOnFlakyTests && test.outcome() === 'flaky');
	}

	onEnd(result: FullResult): void {
		// Serial tests share state. A partially completed serial group must be
		// replayed together, just as Playwright replays it when retrying a failure.
		const tests = [...this.#tests.values()];
		if (result.status === 'interrupted') {
			const unfinishedGroups = new Set(tests.filter((test) => !test.complete).map((test) => test.serialGroup));
			for (const test of tests) {
				if (test.serialGroup !== null && unfinishedGroups.has(test.serialGroup)) test.complete = false;
			}
		} else {
			for (const test of tests) test.complete = true;
		}
		if (this.#file) writeFileSync(this.#file, JSON.stringify({ tests, status: result.status } satisfies NightlyCheckpoint));
	}
}

function serialGroup(suite: Suite | undefined): string | null {
	let group: string | null = null;
	for (let current = suite; current; current = current.parent) {
		// Playwright exposes serial mode through the suite used by its dispatcher.
		if ((current as Suite & { _parallelMode?: string })._parallelMode === 'serial') {
			group = JSON.stringify(current.titlePath());
		}
	}
	return group;
}
