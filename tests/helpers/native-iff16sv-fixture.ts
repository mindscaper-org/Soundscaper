/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
// Untouched libsndfile1.2.2 SF_FORMAT_SVX|SF_FORMAT_PCM_16 output, mono48k/4800frames.
// Independent FFmpeg5.1.4/core0.12.10 IFF->float PCM reference; compression only packages exact fixture bytes.
const ENCODED = [
	'eJzt0clL3FAYAPBk1mTWLAouB2NpEcEpDIUqeFJnSgfqgm0FT1LRKaG2Fp2KRdBREMTOrQepN08e2oO3OWilF0EPxYOCCAX14ELNm8yezGLS7+C/0NsXeOGR971vye9Z/2AvRT36G3z6cmjoeWiQoqgaihJ+UffPdpyGt2n2dfWGYcNNfxiLyhPjgemZ2cdyNEp19fX1w/cHE/Lo/ZE0+lkKT8nvpLFxqefNdGxqUnox+XGS6u4PDUOlOEQv0jS9ZLFYlqy0NW41bHM23R6zqw7ZceEcdh4yISbJtrLrLsb1yXXujri3PLWeWc+pt9371Ut8Yd83n+Lv9K/4j7gGboTb4M74Rv4Vv8r/5IlQL3QLspAQvgv7woWgiaxYJz4U28Sg+ARWG+zrRFbQ4GwfYhIQ2y3U8wTurkKORu4M8o1wDf4jyN/pU6BW2EugbrvnFHqodW+5I65z6Ith19lWJsmEnIfOYceFQ7ar9phNt81ZDZiJtsB8',
	'9BJNU4vw9xYM05i/M+7mq2Y1XrVUlitMOVHmS2ulJn1TD2o7WqR4UowW9MKXgpRP5gdyt7mVXEv2IPs+K2a2M28zNem99Gw6oF6pG+qI2py6TP1IzaR6UiK5JrtkjcTIa9JBmgiraMqN8kc5Vg6V37COYX+jaISFsw6IiUHsLrlOiXB3BnJcqs2Qb0O9Sgcg/16mBmptZ0Woe5BrgR5u8wP5ZEGCvvRitHiiRbQdPahvlppKa2W+nKgwleWqBWYy72A+Y94wzQX0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0RV/0/X++/wCVXa6D',
].join('');
const REFERENCE = [
	'eJztkzFLXEEUhS+BiIQExSRqqvgLgr07w6azWbC0sLAM2KS120AKIU1Ipd3r0i0pLAK7M6yVaQTBxjRhC4vYpEmzjZjzveefCJyFy9u5M3Pn3nP4Ivh92Iph9CLe9mI4VDS96E+1nun/fS/2l1LE6xTDNylmKcXGQLGnOND6MEX/Y4r3n1J8/pKiOdG5JsXOV90ZKXeq71jrM+XPtb7Q2asUmz9TXP5S/ka52xTTPym+/dWZufbutBc55o9yLD7WdyHH9WKO5kmOnac5fj/L8W4px4/lHMsrObaf59h/kWP3ZY7+qu6s5fiu2F7PMVVsvNK+4khx/PBlTZ59znGee9ynDvWoS33e4T3e5X36oB/6avtTn/RL3/TPHMzDXMzHnMzL3MyPDuiBLq0+o04vdEM/dERPdEVfdG71HnT64wN+4Av+4BN+4Rv+tT7ip3zt/B1rPVF+on1FM9F5rWf6fz9RnaJ6RXWL6he9o9hTHGh9WNRHUT9F',
	'fRX1p3NNUb+6M1LuVN+x1mfKn2t9obNXRfMWza38jXK3RXoU6aIzc+3daS+qdKvST9+FKj2rdK3St0rnKr2rdK/Sv8qHKj+qfKnyR3fWqvxSfr3Kvyofta84Uhw/fFmTZ59znOce96lDPepSn3d4j3d5nz7oh77a/tQn/dI3/TMH8zAX8zEn8zI386MDeqBLq8+o0wvd0A8d0RNd0RedW70Hnf74gB/4gj/4hF/4hn+tj/gpX82v+TW/5tf8ml/za37Nr/k1v+bX/Jpf82t+za/5Nb/m1/yaX/Nrfs2v+TW/5tf8ml/za37Nr/k1v+bX/Jpf82t+za/5Nb/m1/yaX/Nrfs2v+TW/5tf8ml/za37Nr/k1v+bX/Jpf82t+za/5Nb/m1/ya3/+Q33/Gzppx',
].join('');
const SHA256 = '03459edc9f7f7184a43b6dbfab8af995cc5e432e3ac4148663f6c208251ffb6f';

export function nativeIff16svFixture(): Readonly<{ file: File; channels: readonly Float32Array[] }> {
	const bytes = Uint8Array.from(inflateSync(Buffer.from(ENCODED, 'base64')));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), SHA256);
	const reference = inflateSync(Buffer.from(REFERENCE, 'base64'));
	assert.equal(reference.length, 4800 * 4);
	return { file: new File([bytes], 'Recording.iff', { type: 'application/octet-stream' }),
		channels: [Float32Array.from({ length: 4800 }, (_, frame) => reference.readFloatLE(frame * 4))] };
}
