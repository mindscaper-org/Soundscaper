/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseReleaseVersion, releaseTagForVersion } from '../../src/common/release/release-version.ts';
import { calendarPackageVersion } from '../../src/common/release/release-packaging.ts';

const readFileAsync = promisify(readFile);
const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);
const CHANNELS = Object.freeze(['candidate', 'stable']);
const VERSION_CORE = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;
const PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
	String.raw`^${VERSION_CORE}(?:-(?:beta|rc)\.${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*)?$`, 'u',
);
const STABLE_SEMVER = new RegExp(`^${VERSION_CORE}$`, 'u');
const CONFIG_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)), '../../config/product-release-lines.json',
);

export const PRODUCT_RELEASE_LINES_PATH = 'config/product-release-lines.json';

export async function readProductReleaseLines(repositoryRoot) {
	const path = repositoryRoot === undefined
		? CONFIG_PATH
		: resolve(repositoryRoot, PRODUCT_RELEASE_LINES_PATH);
	return validateProductReleaseLines(JSON.parse(await readFileAsync(path, 'utf8')));
}

export function readProductReleaseLinesSync(repositoryRoot) {
	const path = repositoryRoot === undefined
		? CONFIG_PATH
		: resolve(repositoryRoot, PRODUCT_RELEASE_LINES_PATH);
	return validateProductReleaseLines(JSON.parse(readFileSync(path, 'utf8')));
}

export function validateProductReleaseLines(value) {
	const root = exactRecord(value, ['schemaVersion', 'products'], 'Product release lines');
	if (![2, 3].includes(root.schemaVersion)) throw new Error('Product release lines schemaVersion must be 3 (or legacy 2).');
	const products = exactRecord(root.products, PRODUCT_IDS, 'Product release-line products');
	const validated = {};
	for (const productId of PRODUCT_IDS) {
		const row = exactRecord(products[productId], [
			'productId', 'applicationVersionChannel', 'releaseChannel', 'candidate', 'stable',
		], `${productId} release line`);
		if (row.productId !== productId || !CHANNELS.includes(row.applicationVersionChannel)
			|| ![...CHANNELS, 'deferred'].includes(row.releaseChannel)) {
			throw new Error(`${productId} release-line identity is invalid.`);
		}
		const candidate = validateChannel(row.candidate, productId, 'candidate', root.schemaVersion);
		const stable = validateChannel(row.stable, productId, 'stable', root.schemaVersion);
		if (row.releaseChannel === 'deferred' && productId !== 'framescaper') {
			throw new Error('Only the declared deferred product may have a deferred release channel.');
		}
		if (row.releaseChannel !== 'deferred'
			&& row.applicationVersionChannel !== row.releaseChannel) {
			throw new Error(`${productId} application and release channels must be synchronized.`);
		}
		validated[productId] = {
			...row,
			candidate,
			stable,
		};
	}
	return deepFreeze({ schemaVersion: root.schemaVersion, products: validated });
}

export function resolveProductApplicationVersion(productId, releaseLinesValue) {
	const releaseLines = releaseLinesValue === undefined
		? readProductReleaseLinesSync()
		: validateProductReleaseLines(releaseLinesValue);
	const product = releaseProduct(productId, releaseLines);
	return product[product.applicationVersionChannel].version;
}

export function resolveProductDesktopMetadata(productId, releaseLinesValue) {
	const releaseLines = releaseLinesValue === undefined
		? readProductReleaseLinesSync()
		: validateProductReleaseLines(releaseLinesValue);
	const product = releaseProduct(productId, releaseLines);
	const channel = product.applicationVersionChannel;
	const calendar = parseReleaseVersion(product[channel].version)?.kind === 'calendar';
	return deepFreeze({
		schemaVersion: calendar ? 2 : 1,
		id: product.productId,
		applicationVersion: product[channel].version,
		...(calendar ? { packageVersion: calendarPackageVersion(product[channel].version) } : {}),
		applicationVersionChannel: channel,
		releaseChannel: product.releaseChannel,
		updateTagPrefix: product[channel].tagPrefix,
	});
}

export function expectedProductReleaseTag(productId, releaseLinesValue, channelValue) {
	const releaseLines = releaseLinesValue === undefined
		? readProductReleaseLinesSync()
		: validateProductReleaseLines(releaseLinesValue);
	const product = releaseProduct(productId, releaseLines);
	const channel = channelValue ?? product.applicationVersionChannel;
	if (!CHANNELS.includes(channel)) throw new Error(`Unknown ${productId} release channel ${String(channel)}.`);
	return releaseTagForVersion(product[channel].version, product[channel].tagPrefix);
}

export function resolveProductReleaseTag(tagValue, releaseLinesValue) {
	const tag = String(tagValue ?? '');
	const releaseLines = releaseLinesValue === undefined
		? readProductReleaseLinesSync()
		: validateProductReleaseLines(releaseLinesValue);
	for (const productId of PRODUCT_IDS) {
		const product = releaseLines.products[productId];
		for (const channel of CHANNELS) {
			if (tag !== releaseTagForVersion(product[channel].version, product[channel].tagPrefix)) continue;
			if (product.releaseChannel === 'deferred') {
				throw new Error(`${productId} release channel is deferred.`);
			}
			if (product.releaseChannel !== channel) {
				throw new Error(`${productId} ${channel} release line is not active.`);
			}
			return deepFreeze({ productId, channel, version: product[channel].version });
		}
	}
	throw new Error(`Release tag ${JSON.stringify(tag)} is not declared by a product release line.`);
}

function validateChannel(value, productId, channel, schemaVersion) {
	const row = exactRecord(value, ['version', 'tagPrefix'],
		`${productId} ${channel} release channel`);
	const parsed = parseReleaseVersion(row.version);
	if (schemaVersion === 3 || parsed?.kind === 'calendar') {
		const name = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
		if (parsed?.kind !== 'calendar' || parsed.text !== row.version || parsed.product !== name
			|| (channel === 'stable') !== (parsed.channel === 'stable')) throw new Error(`${productId} ${channel} release version is invalid.`);
		calendarPackageVersion(row.version);
		if (row.tagPrefix !== name) throw new Error(`${productId} ${channel} release tag ownership is invalid.`);
		return { ...row };
	}
	if (!SEMVER.test(row.version) || (channel === 'stable' && !STABLE_SEMVER.test(row.version))) {
		throw new Error(`${productId} ${channel} release version is invalid.`);
	}
	if (typeof row.tagPrefix !== 'string' || !/^(?:v|(?:soundscaper|framescaper)-v)$/u.test(row.tagPrefix)) {
		throw new Error(`${productId} ${channel} release tag prefix is invalid.`);
	}
	if ((productId === 'soundscaper' && channel === 'stable' && row.tagPrefix !== 'v')
		|| (channel === 'candidate' && row.tagPrefix !== `${productId}-v`)
		|| (productId === 'framescaper' && row.tagPrefix !== 'framescaper-v')) {
		throw new Error(`${productId} ${channel} release tag ownership is invalid.`);
	}
	return { ...row };
}

function releaseProduct(productIdValue, releaseLines) {
	const productId = String(productIdValue ?? '');
	const product = releaseLines.products[productId];
	if (product === undefined) throw new Error(`Unknown release product ${JSON.stringify(productId)}.`);
	return product;
}

function exactRecord(value, fields, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new Error(`${label} must have exact fields: ${fields.join(', ')}.`);
	}
	return value;
}

function deepFreeze(value) {
	for (const child of Object.values(value)) {
		if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
	}
	return Object.freeze(value);
}
