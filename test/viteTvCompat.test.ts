import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addCssFallbacks, toStageUnits } from '../vite-tv-compat.ts';

describe('addCssFallbacks', () => {
  it('expands single-value inset into top/right/bottom/left fallbacks', () => {
    const input = '.modal { position: fixed; inset: 0; z-index: 100; }';
    const output = addCssFallbacks(input);
    assert.match(output, /top:\s*0;/);
    assert.match(output, /right:\s*0;/);
    assert.match(output, /bottom:\s*0;/);
    assert.match(output, /left:\s*0;/);
    assert.match(output, /inset:\s*0;/);
  });

  it('expands 2-value and 4-value inset correctly', () => {
    const input2 = '.box { inset: 10px 20px; }';
    const output2 = addCssFallbacks(input2);
    assert.match(output2, /top:\s*10px;\s*right:\s*20px;\s*bottom:\s*10px;\s*left:\s*20px;\s*inset:\s*10px 20px;/);

    const input4 = '.box { inset: 1px 2px 3px 4px; }';
    const output4 = addCssFallbacks(input4);
    assert.match(output4, /top:\s*1px;\s*right:\s*2px;\s*bottom:\s*3px;\s*left:\s*4px;\s*inset:\s*1px 2px 3px 4px;/);
  });

  it('preserves !important flag and ignores properties starting with inset-', () => {
    const input = '.box { inset: 5px !important; inset-block: 0; }';
    const output = addCssFallbacks(input);
    assert.match(output, /top:\s*5px\s*!important;/);
    assert.match(output, /inset:\s*5px\s*!important;/);
    assert.match(output, /inset-block:\s*0;/);
  });

  it('keeps min/max/clamp fallback functionality intact', () => {
    const input = '.card { font-size: min(20px, 30px); }';
    const output = addCssFallbacks(input);
    assert.match(output, /font-size:\s*20px;/);
    assert.match(output, /font-size:\s*min\(20px, 30px\);/);
  });
});

describe('toStageUnits', () => {
  it('turns viewport units into pixels of the 1920x1080 stage', () => {
    assert.strictEqual(toStageUnits('.a { width: 100vw; height: 100vh; }'), '.a { width: 1920px; height: 1080px; }');
    assert.strictEqual(toStageUnits('.a { padding: 0 min(48px, 2.5vw); }'), '.a { padding: 0 min(48px, 48px); }');
    assert.strictEqual(toStageUnits('.a { height: calc(100vh - 68px); top: clamp(74px, 9vh, 92px); }'), '.a { height: calc(1080px - 68px); top: clamp(74px, 97.2px, 92px); }');
  });

  it('leaves everything else alone', () => {
    const css = '.col-5vw, #a5vh { width: 50%; margin: 5px; color: #05vhaa; } @media (max-width: 1300px) { .b { flex: 1 1 calc(20% - 10px); } }';
    assert.strictEqual(toStageUnits(css), css);
  });
});
