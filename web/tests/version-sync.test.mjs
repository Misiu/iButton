import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MINIMUM_FIRMWARE_VERSION,
  SUPPORTED_PROTOCOL_VERSION,
  compareVersions
} from '../protocol.js';

test('web and firmware versions stay compatible', async () => {
  const source = await readFile(new URL('../../firmware/src/main.cpp', import.meta.url), 'utf8');
  const firmwareVersion = /FW_VERSION\[\] = "([^"]+)"/.exec(source)?.[1];
  const protocolVersion = /PROTOCOL_VERSION\[\] = "([^"]+)"/.exec(source)?.[1];

  assert.ok(firmwareVersion, 'firmware version is missing');
  assert.ok(protocolVersion, 'protocol version is missing');
  assert.equal(protocolVersion, SUPPORTED_PROTOCOL_VERSION);
  assert.ok(compareVersions(firmwareVersion, MINIMUM_FIRMWARE_VERSION) >= 0);
});
