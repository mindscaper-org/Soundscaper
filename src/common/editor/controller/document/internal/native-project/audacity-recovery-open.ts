/* SPDX-License-Identifier: AGPL-3.0-only */

const DAMAGE_CODES = new Set([
	'INVALID_BINARY_XML', 'INVALID_DICTIONARY', 'INVALID_DOCUMENT', 'INVALID_PROJECT_XML',
	'TRUNCATED_BINARY_XML', 'UNKNOWN_FIELD', 'UNKNOWN_NAME', 'UNCLOSED_TAG', 'MISMATCHED_TAG',
	'INVALID_ROOT_COUNT', 'INVALID_CHAR_SIZE', 'INVALID_STRING', 'INVALID_LENGTH',
	'MISSING_ROOT', 'INVALID_SAMPLE_RATE', 'INVALID_XML_VERSION',
	'MISSING_SAMPLE_BLOCK', 'INVALID_SAMPLE_BLOCK', 'CORRUPT_SEQUENCE', 'CORRUPT_DATABASE', 'EMPTY_PROJECT',
]);

/** Retry only damaged data, through the same immutable File and private worker copy. */
export async function openAudacityWithRecovery<File, Options extends { readonly recover?: boolean }, Result>(
	client: { openFile(projectId: string, file: File, options: Options): Promise<Result> },
	projectId: string, file: File, options: Options,
): Promise<Result> {
	try { return await client.openFile(projectId, file, options); }
	catch (error: unknown) {
		if (options.recover || !isDamage(error)) throw error;
		return client.openFile(projectId, file, { ...options, recover: true });
	}
}

function isDamage(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = 'code' in error ? String(error.code) : '';
	return DAMAGE_CODES.has(code) || code === '11' || code === '26'
		|| (code === 'AUP4_WORKER_ERROR' && /database disk image is malformed|database corruption|file is not a database/iu.test(error.message));
}
