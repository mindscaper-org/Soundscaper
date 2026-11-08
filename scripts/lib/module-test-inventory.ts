/* SPDX-License-Identifier: AGPL-3.0-only */

import { currentModuleSnapshot } from './check-module-repository.ts';
import { parseModulePolicy } from './module-policy.ts';
import { buildModuleTestSuites, type ModuleTestSuite } from './module-test-suites.ts';

export function repositoryModuleTestSuites(root: string): ModuleTestSuite[] {
	const snapshot = currentModuleSnapshot(root);
	const policy = parseModulePolicy(JSON.parse(snapshot.get('config/module-policy.json') ?? 'null') as unknown);
	const files = [...snapshot.keys()];
	return buildModuleTestSuites({ policy, snapshot,
		nodeTests: files.filter(file => /^tests\/[^/]+\.test\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file)),
		browserTests: files.filter(file => /^tests\/browser\/(?!handbook\/|dual-origin\/|audiocity\/).*\.spec\.[jt]sx?$/u.test(file)),
	});
}
