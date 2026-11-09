import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderArt,
  isUsableArtworkUrl,
  normalizeArtworkTitle,
  collectPosterAlternates,
  enrichSearchItems
} from '../src/lib/searchArtwork.ts';
import { isAdultItem } from '../src/lib/catalogOrganizer.ts';
import {
  indexEnd,
  parseIdxg,
  groupIdxgSegments,
  buildVodTsPlaylist,
  parseContentRangeTotal,
  recoverVodMediaSize
} from '../src/lib/vodIdxg.ts';
import {
  markImageLoaded,
  markImageFailed,
  isImagePrecached,
  isImageFailed,
  getImageCacheStats
} from '../src/lib/imageCache.ts';
import { probeImage } from '../src/services/diagnosticService.ts';
import { historyService } from '../src/services/historyService.ts';

/** Helper to construct a valid binary `.idxg` buffer for unit tests */
function makeIdxgBuffer(name: string, entries: Array<{ off: number; ts: number }>): Uint8Array {
  const tableStart = 48; // >= 32 and leaves 32 bytes for header + filename
  const buf = new Uint8Array(tableStart + entries.length * 12);
  // Magic "idxg" at bytes 4..7
  buf[4] = 0x69;
  buf[5] = 0x64;
  buf[6] = 0x78;
  buf[7] = 0x67;
  // Filename at byte 16
  for (let i = 0; i < name.length && 16 + i < tableStart - 1; i++) {
    buf[16 + i] = name.charCodeAt(i);
  }
  const view = new DataView(buf.buffer);
  for (let i = 0; i < entries.length; i++) {
    const pos = tableStart + i * 12;
    const hi = Math.floor(entries[i].off / 4294967296);
    const lo = entries[i].off >>> 0;
    view.setUint32(pos, hi, false);
    view.setUint32(pos + 4, lo, false);
    view.setUint32(pos + 8, entries[i].ts, false);
  }
  return buf;
}

describe('Point 1: Search Artwork Recovery & Image Fallback Cascade', () => {
  it('detects placeholder URLs and keeps only usable artwork URLs', () => {
    assert.equal(isPlaceholderArt(''), true);
    assert.equal(isPlaceholderArt('assets/placeholder_vertical.png'), true);
    assert.equal(isPlaceholderArt('/assets/placeholder_landscape.png?v=1'), true);
    assert.equal(isUsableArtworkUrl('assets/placeholder_vertical.png'), false);
    assert.equal(isUsableArtworkUrl('https://cdn.example.com/posters/123.jpg'), true);
  });

  it('collects deduplicated poster alternates excluding placeholders', () => {
    const alts = collectPosterAlternates(
      'assets/placeholder_vertical.png',
      'https://cdn1.example.com/p1.jpg',
      ['https://cdn1.example.com/p1.jpg', 'https://cdn2.example.com/p2.jpg'],
      'assets/placeholder_horizontal.png',
      'https://cdn3.example.com/backdrop.jpg'
    );
    assert.deepEqual(alts, [
      'https://cdn1.example.com/p1.jpg',
      'https://cdn2.example.com/p2.jpg',
      'https://cdn3.example.com/backdrop.jpg'
    ]);
  });

  it('enriches search items by ID and by normalized title + year + kind', () => {
    const catalogPool = [
      {
        id: 'cat-100',
        title: 'Gladiador II',
        year: '2024',
        kind: 'pelicula' as const,
        poster: 'https://cdn.good.com/gladiador2-v.jpg',
        landscape: 'https://cdn.good.com/gladiador2-h.jpg',
        backdrop: 'https://cdn.good.com/gladiador2-bg.jpg'
      },
      {
        id: 'cat-200',
        title: 'The Last of Us - Temporada 1',
        year: '2023',
        kind: 'serie' as const,
        isSeries: true,
        poster: 'https://cdn.good.com/tlou-v.jpg',
        posterAlternates: ['https://cdn.good.com/tlou-v.jpg', 'https://cdn.backup.com/tlou-v2.jpg']
      }
    ];

    const searchResults = [
      // Same ID, broken/placeholder poster in search result
      {
        id: 'cat-100',
        title: 'Gladiador II',
        year: '2024',
        kind: 'pelicula' as const,
        poster: 'assets/placeholder_vertical.png'
      },
      // Different ID from v3/searchByName, matched by normalized title + year + kind
      {
        id: 'search-999',
        title: 'The Last of Us',
        year: '2023',
        kind: 'serie' as const,
        isSeries: true,
        poster: ''
      }
    ];

    const enriched = enrichSearchItems(searchResults, catalogPool, true);
    assert.equal(enriched[0].poster, 'https://cdn.good.com/gladiador2-v.jpg');
    assert.equal(enriched[0].landscape, 'https://cdn.good.com/gladiador2-h.jpg');
    assert.equal(enriched[1].poster, 'https://cdn.good.com/tlou-v.jpg');
    assert.ok(enriched[1].posterAlternates?.includes('https://cdn.backup.com/tlou-v2.jpg'));
    assert.equal(normalizeArtworkTitle('The Last of Us - Temporada 1'), 'the last of us');
  });
});

describe('Point 2: Strict Adult (+18) Detection & Privacy Flags', () => {
  it('flags items with restricted, privateContent, or adult column 76300 even without explicit title keywords', () => {
    assert.equal(
      isAdultItem({
        id: 'a1',
        title: 'Midnight Confessions',
        category: '',
        restricted: true
      }),
      true
    );
    assert.equal(
      isAdultItem({
        id: 'a2',
        title: 'Summer Story',
        category: '',
        privateContent: true
      }),
      true
    );
    assert.equal(
      isAdultItem({
        id: 'a3',
        title: 'Untold Desire',
        category: '',
        columnId: 76300
      } as any),
      true
    );
    assert.equal(
      isAdultItem({
        id: 'm1',
        title: 'Spider-Man: Lejos de Casa',
        category: 'pelicula'
      }),
      false
    );
  });

  it('prevents restricted/private items from being stored in historyService', () => {
    historyService.markPrivate({ id: 'priv-900' });
    assert.equal(historyService.isRestricted({ id: 'priv-900', title: 'Normal Title' }), true);
    historyService.savePlayback(
      { id: 'priv-900', title: 'Normal Title', category: '' },
      120,
      3600
    );
    assert.equal(historyService.getEntry('priv-900'), undefined);
  });
});

describe('Point 3: VOD .idxg Parser & Media Size Recovery', () => {
  const sampleEntries = [
    { off: 0, ts: 0 },
    { off: 188000, ts: 2000 },
    { off: 376000, ts: 4000 },
    { off: 564000, ts: 6000 }
  ];
  const sampleBuf = makeIdxgBuffer('movie_1080p.ts', sampleEntries);

  it('finds the last valid byte offset via indexEnd()', () => {
    assert.equal(indexEnd(sampleBuf), 564000);
    assert.equal(indexEnd(new Uint8Array(16)), 0);
  });

  it('parses .idxg segments, groups them, and builds an HLS byte-range VOD playlist', () => {
    const parsed = parseIdxg(sampleBuf, 752000);
    assert.equal(parsed.name, 'movie_1080p.ts');
    assert.equal(parsed.mediaTotal, 752000);
    assert.equal(parsed.segments.length, 4);
    assert.deepEqual(parsed.segments[0], { start: 0, length: 188000, duration: 2 });
    assert.deepEqual(parsed.segments[3], { start: 564000, length: 188000, duration: 1 });

    const grouped = groupIdxgSegments(parsed, 4);
    assert.equal(grouped.segments.length, 2);
    assert.deepEqual(grouped.segments[0], { start: 0, length: 376000, duration: 4 });
    assert.deepEqual(grouped.segments[1], { start: 376000, length: 376000, duration: 3 });

    const m3u8 = buildVodTsPlaylist(grouped, 'http://cdn.vod.local/vod/abc_media.ts');
    assert.ok(m3u8.includes('#EXT-X-PLAYLIST-TYPE:VOD'));
    assert.ok(m3u8.includes('#EXT-X-BYTERANGE:376000@0'));
    assert.ok(m3u8.includes('#EXT-X-BYTERANGE:376000@376000'));
    assert.ok(m3u8.includes('#EXT-X-ENDLIST'));
  });

  it('recovers exact VOD media size when Content-Range omits total size', async () => {
    assert.equal(parseContentRangeTotal('bytes 0-0/999888'), 999888);
    assert.equal(parseContentRangeTotal('bytes 0-0/*'), 0);

    // Case A: CDN returns 206 with 145000 tail bytes after `end` (564000)
    const sizeWithTail = await recoverVodMediaSize(sampleBuf, async (range) => {
      if (range === 'bytes=563999-563999') {
        return { status: 206, byteLength: 1, contentRange: 'bytes 563999-563999/*' };
      }
      return { status: 206, byteLength: 145000, contentRange: null };
    });
    assert.equal(sizeWithTail, 564000 + 145000);

    // Case B: CDN returns 416 Range Not Satisfiable at `end` -> exact size is `end`
    const sizeExactEnd = await recoverVodMediaSize(sampleBuf, async (range) => {
      if (range === 'bytes=563999-563999') {
        return { status: 206, byteLength: 1, contentRange: null };
      }
      return { status: 416, byteLength: 0, contentRange: null };
    });
    assert.equal(sizeExactEnd, 564000);
  });
});

describe('Point 4: Poster Cache Tracking & Safe Host Diagnostic Probe', () => {
  it('tracks loaded vs failed image URLs and strips query tokens from diagnostic hosts', async () => {
    markImageFailed('https://img.cdn-test.net/posters/bad.jpg');
    assert.equal(isImageFailed('https://img.cdn-test.net/posters/bad.jpg'), true);

    markImageLoaded('https://img.cdn-test.net/posters/bad.jpg');
    assert.equal(isImageFailed('https://img.cdn-test.net/posters/bad.jpg'), false);
    assert.equal(isImagePrecached('https://img.cdn-test.net/posters/bad.jpg'), true);

    const stats = getImageCacheStats();
    assert.ok(stats.loaded >= 1);

    const probe = await probeImage('Póster', 'https://img.cdn-test.net:8443/secret/path.jpg?token=abc123');
    assert.equal(probe.host, 'img.cdn-test.net');
    assert.equal(probe.ok, true);
  });
});
