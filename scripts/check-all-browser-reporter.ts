/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FullResult, Reporter, TestCase, TestError, TestResult } from '@playwright/test/reporter';

import { progressRecord } from './lib/check-all-output.ts';

export default class CheckAllBrowserReporter implements Reporter {
	printsToStdio(): boolean { return true; }

	onTestBegin(test: TestCase, result: TestResult): void {
		process.stdout.write(progressRecord({ type: 'start', id: test.id, label: `${test.titlePath().filter(Boolean).join(' > ')}${result.retry ? ` (retry ${result.retry})` : ''}` }));
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		process.stdout.write(progressRecord({
			type: 'end', id: test.id,
			...(result.status !== test.expectedStatus && result.status !== 'skipped' ? {
				failure: `${test.titlePath().filter(Boolean).join(' > ')}\n${result.errors.map(formatError).join('\n')}`,
			} : {}),
		}));
	}

	onError(error: TestError): void {
		process.stdout.write(progressRecord({ type: 'end', id: 'runner', failure: formatError(error) }));
	}

	onStdOut(chunk: string | Buffer): void { process.stdout.write(chunk); }
	onStdErr(chunk: string | Buffer): void { process.stderr.write(chunk); }
	onEnd(_result: FullResult): void { /* The scheduler reports the shard exit status. */ }
}

function formatError(error: TestError): string { return error.stack ?? error.message ?? String(error.value); }
