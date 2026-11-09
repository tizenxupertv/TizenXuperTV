import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyPortalError, isRegionBlocked, REGION_BLOCKED_TEXT } from '../src/lib/portalErrors.ts';

const regionError = Object.assign(new Error('v8/active -> portal100024 所在区域为黑名单，栏目不可见'), { portalCode: 'portal100024' });

test('the portal region blacklist (code 100024) is recognised by code, by message or by its Chinese text', () => {
  assert.equal(isRegionBlocked(regionError), true);
  assert.equal(isRegionBlocked({ portalCode: 'portal100024' }), true);
  assert.equal(isRegionBlocked('v8/active -> portal100024'), true);
  assert.equal(isRegionBlocked({ message: '所在区域为黑名单' }), true);
  assert.equal(isRegionBlocked({ portalCode: 'portal100006', message: 'v8/active -> portal100006 x' }), false);
  assert.equal(isRegionBlocked(new Error('timeout')), false);
  assert.equal(isRegionBlocked(null), false);
});

test('a region block reads in Spanish, without the portal code or Chinese text', () => {
  const text = friendlyPortalError(regionError);
  assert.equal(text, REGION_BLOCKED_TEXT);
  assert.doesNotMatch(text, /[㐀-鿿]/);
  assert.doesNotMatch(text, /100024/);
});

test('other portal errors keep only their code; plain errors stay as they are', () => {
  const other = Object.assign(new Error('v9/play -> portal100031 内容不存在'), { portalCode: 'portal100031' });
  assert.equal(friendlyPortalError(other), 'El portal rechazó la solicitud (código portal100031).');
  assert.equal(friendlyPortalError({ message: 'v9/play -> portal100031 内容不存在' }), 'El portal rechazó la solicitud (código portal100031).');
  assert.equal(friendlyPortalError(new Error('No free VOD CDN available')), 'No free VOD CDN available');
  assert.equal(friendlyPortalError(null), 'No se pudo obtener el video del portal.');
});

test('the network diagnostic tells a region block and an operator DNS block from a portal that is down', async () => {
  const { portalVerdict } = await import('../src/services/diagnosticService.ts');
  const found = [{ ok: true }];
  const hidden = [{ ok: false }];
  assert.equal(portalVerdict(regionError, found, 0), 'region-blocked');
  // No portal answer at all, while secure DNS finds the portal: the provider's DNS hides it
  assert.equal(portalVerdict(new Error('Network request failed'), found, 0), 'dns-blocked');
  assert.equal(portalVerdict(new Error('Network request failed'), hidden, 0), 'portal-down');
  assert.equal(portalVerdict(Object.assign(new Error('x'), { portalCode: 'portal100006' }), found, 0), 'portal-down');
  assert.equal(portalVerdict(null, found, 0), 'no-cdn');
  assert.equal(portalVerdict(null, found, 2), 'ok');
});
