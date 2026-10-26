/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
// Untouched libsndfile1.2.2 WAV|PCM_16,1000Hz/1000frames and48000Hz/48000frames.
// One-second .25-amplitude80Hz sine, sf_writef_float; independently read with sf_readf_float.
const ENCODED_1000 = [
	'eJwL8nRz+8LOwBDuGOaalluiIMDAwMAIhC+YGRguAMWZGAQYUhJLEkFsBoYsflbpD/JfZM4LMbNYfIl4PvHBxIcSr7h/fGV/IZovly+/QuIE99/fhm95Hgs8',
	'+P1k2odRHaM6RnWM6hjVMapjVMdg0wEAIwvHYQ==',
].join('');
const REFERENCE_1000 = [
	'eJztzbENwCAMBMCfIjOkywRYNNkhZToGoEFCShiFQcBjUecnyARvyZKLfx/A6StgvwztNfRkKJvhRkAbE/F0lMrNjng4+jO5gTdzmVuNGXZHYGeyy0xy/nL+',
	'5L0mZMiQIUOGDBkyZMiQIUOGDBm/xgdXpAhs',
].join('');
const SHA256_1000 = 'fe110480b84beda716c1c5c4c7fe573d6fd92fa2ab49de02dadac83f11c4f621';
const ENCODED_48000 = [
	'eJzt1PtrU3cYx/GTW++1aZM0aXM5xU6lQgUdsq74Q0Xm1G442q4XkKo4C45NcSrdBkqZsK3IJpWhoAhaBr2sKROtcxuy/iCuIlNQsNRSOUmaNmmT3u/NZc/+',
	'if30ppSeJuec7/M8n4dX1f69e99q1il1u2vfa/r8bJFZURSd/LT8KRfyuV4xK58cPXv0v2tFqVV6FJ2uTufV6fX1eq/eYKg39BoMxnqj16gz1Zp+MSVN1Skd',
	'KespB1PbUxdT96XdSIumVaRfSQ+k78z4NmMwY0vml5kDmfaspqy+LGN2Vfat7Gh2+YbvNrzcoOZ8mtOXo5gPmH8yj5g35Z7M7cuN5e7Ja817nme1NFhuWjRL',
	'sbXJ2mENW0tsJ2xdtpBtc/6x/Fv5I/kOe439R/uAXed413Ha0el447AW7C84X/BrQaDAVvh+YXNhR+GrQpNzh/Ow85LzvtPnzHC97Trkuujqcj13Lbgc7l3u',
	'RneL+7a73625E26np8xT4znlafW0e/7wvPCEPQmPRd2ilqsfqo3qKfWC+oN6Q+1U76l/qU/Ul+qwGlAn1Bl1UV1VY2pCTapKUVL+xuT/Rfl8Qr4flvueyP33',
	'5Lkb8vwFeU+jvK9c3mtRE3LGCzmrXc48JWeXeZyehNTSLzW1SG273A73gtTaJTUfktozXD7p45L0s8Npcr6S/pqlT1thQHo+L71bC97IHE7LPHSOAZlNjd1h',
	'H5FZHcvfnB+S2Z2wldjCMssma7FVk9k2WKyW5zLrPXkxmfvJ3E25I5LDAbNi7pNc1JyXklH5hqjkVZVtzO6T/OxZA5LllsxByXVnRkAyrkiPSt770hYl+4Op',
	'67IH1SlJ2Ylak87klR0xGHtlXwwGr+yOXu+VPdLpemSnFKU7WZNMJroS1YlEvDNeHY/HOmNVsfh653r1enKte+3jNd2ad7Vh1bR6Z6VxJXPlwfLxZcty/9LJ',
	'JffS08WvF0sWhxa+XyhbCM9fn6+cj831zh2Zs8w9nv1qtnTWN3N1pnJGmbk//dl08fTw1JWpyinj1MNoc3R7NBLpiByLFEVGJq9PNkzaJwcnrk3UTTgmXodv',
	'ho+Ei8OhUE/oi1BZKDn+9/jl8frxjeORsd/GLo59NOYemwz+HmwNNgS3BtdHn43eHj03emBUHV0K/BP4OXA+UBfYHsgKhPyP/O3+Fv9hf4W/yK/3B30Dvh5f',
	'm6/Z1+jb69vms/v0vqg2pD3W7mrtWpv2jXZGO67Vax9ou7V3tFJtk+bW8jWzlqmlakZNr+k0RX71cp0qn5nlO7fcUyr37pZn6uXZM/KONnnXXXnnkBbV9HLG',
	'NjmrUc5sk7MHfEGfXmqpkJpapLZH/pA/S2qtk5p/ltqXAqr0cU76eTa6PrpV+muVPieDbun5ovQeGdsoc7gs80iOl8lsekKhULHM6mb4ddghs7s2MThhl1le',
	'nxyZLJLZdkQike0y64dRo8z9ytTwVLHkcH9akUyuzvhmSiWjx7MWyat3LjZXKfmF58sky6GFEsn16aJbMu5fskjeD5YzJfs7KybZA++qTnaiey25Vi07El+v',
	'kn2Jx6pldxLxatmjZKIm2Z3EK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zC',
	'K7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zC',
	'K7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zC',
	'K7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zC',
	'K7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zC',
	'K7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zC',
	'K7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCK7zCq//fq38B/8imng==',
].join('');
const REFERENCE_48000 = [
	'eJzt1s2rXdUZB+BFKaVFSktpSyhClVJsaqWKRETv2UaKJUSKIY1iSyVR/EgkavyoxqjxDjpoJ8WBlDgpQieBtiBOLHjPJk4k4CQTJTiQgJOACOlELmTS3++c',
	'+1eU58LLvmfvtdZee633XTxj9O8Xd47xrzvH5tgYmzcmHkhsbozxt42x958b49y5/P9J7n2xMY6MxRjXLMbbP1iM665bjHM/X4wjexbj0l257s/1UK6Hcz22',
	'GHtfSLvTi7H5p8V45y+LceGv6ftm+r21GDf/fTEO/CNtzy7GiX8n3k279xJb+f+D3P8wzz/KGBfS/uP0+zT9P8t4n+f55fT/cjGu/De/v0q7q3k+pnHga9N4',
	'++vTuPyNafzsW9M4cc00zn57Gpe+M41d35vGvu9P4+QP02bXNM7/KO2uncb4cZ5dP42bfzKN23+aNjckdiduTNw0jb2/zLNb0ubWtN2TPrdN49ztGeOOjL+R',
	'59M0vrk34909jT//Kr/vmcaVX+f5vvTfn/b3TmPzN+l/X+ZyIO84OI3//DbX+6fxzgOZ54PTeON309j+/TQe/EPuPZTxDudbjkzjzMOZ+yPp+2jGeixzfzzj',
	'PpH3H839Y3nPk5nT8bR/KtenE8/kXuLiibR5Nm2fS5/n0/eFaXz3j9O4kHjjxfx+Ke0SZ05mHi/nfuLoqdxLnHwl18TRVzNOYu9rGSexndh3On0SFxO7Xs8c',
	'E5uJs4nziUuJK4ntxNhcX6/s3D+/025zp1/7X9wZr+Nu77yn7+t7+/7OYzWfU+v5dZ6db+fd+fc7+j39rn5fv7Pf2+/u93cduh5dl67Pap2Or9et69d17Hp2',
	'Xbu+Xeeud9e969996H50X7o/3afuV/et+7fax4Prfe3+dp+739337n/zoPnQvGh+NE+aL82b5k/zqPnUvGp+Nc+ab827Vf7tXudj87L52TxtvjZvm7/N4+Zz',
	'87r53Txvvjfvm/+tg9ZD62JVH1fX9dK6af20jlpPravWV+us9da6a/21DluPrcvWZ+u09dq6bf22jlvPrevWd+u89d66b/2vzoFDO+fCXetzoudFz42eHz1H',
	'ep70XOn50nOm503PnZ4/q3Oo51HOpZ5Pq3NqdV69n9/v5/5WniceSGxupd9W+m9lnPz/Se59sZXxl3nPMu9b5r3LvH+ZeSwzn1z353oo18O5Hltm3ml3epnv',
	'WOZ7lvmu9H0z/d5a5nuX+e60PbvMOiTeTbv3Elv5/4Pc/zDPP8oYF9L+4/T7NP0/y3if5/nl9P9ymXXP76/S7mqejzn7Mmd/5uzTnP2as29z9m/OPs7Zzzn7',
	'Omd/02bXnP1Ou2vn7H+eXT8nH+bkRdrckNiduDFx05z8ybNb0ubWtN2TPrfNybOMcUfG38jzaU4eZry75+Rlft8zJ0/zfF/670/7e+fkcfrfl7kcyDsOzsnz',
	'XO+fk/eZ54Nz6mBOPcypi9x7KOMdzrccmVM3mfsj6ftoxnosc3884z6R9x/N/WN5z5OZ0/G0fyrXpxPP5F7i4om0eTZtn0uf59P3hTn1PKeu864X8/ultEuc',
	'OZl5vJz7iaOnci9x8pVcE0dfzTiJva9lnMR2Yt/p9ElcTOx6PXNMbCbOJs4nLiWuJLYTY3N9vbJz//xOu82dfu1/cWe8jru9856+r+/t+zuP1XxOrefXeXa+',
	'nXfn3+/o9/S7+n39zn5vv7vf33XoenRduj6rdTq+XreuX9ex69l17fp2nbveXfeuf/eh+9F96f50n7pf3bfu32ofD673tfvbfe5+d9+7/82D5kPzovnRPGm+',
	'NG+aP82j5lPzqvnVPGu+Ne9W+bd7nY/Ny+Zn87T52rxt/jaPm8/N6+Z387z53rxv/rcOWg+ti1V9XF3XS+um9dM6aj21rlpfrbPWW+uu9dc6bD22LlufrdPW',
	'a+u29ds6bj23rlvfrfPWe+u+9b86Bw7tnAt3rc+Jnhc9N3p+9BzpedJzpedLz5meNz13ev6szqGeRzmXej6tzim+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+',
	'4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4iu+4qv/f1/9',
	'D4qXtxQ=',
].join('');
const SHA256_48000 = '2c495eb8ab1615266f88d1c6fde53eb78e911b6a6536e22d23def203412d489e';

export function lowClockPcmFixture(rate: 1000 | 48000): Readonly<{ file: File; channel: Float32Array }> {
	const bytes = Uint8Array.from(inflateSync(Buffer.from(rate === 1000 ? ENCODED_1000 : ENCODED_48000, 'base64')));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), rate === 1000 ? SHA256_1000 : SHA256_48000);
	const reference = inflateSync(Buffer.from(rate === 1000 ? REFERENCE_1000 : REFERENCE_48000, 'base64'));
	const channel = Float32Array.from({ length: rate }, (_, frame) => reference.readFloatLE(frame * 4));
	return { file: new File([bytes], `Original ${rate}.wav`, { type: 'audio/wav' }), channel };
}
