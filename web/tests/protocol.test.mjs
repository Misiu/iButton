import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMUM_FIRMWARE_VERSION,
  SUPPORTED_BOARD,
  SUPPORTED_PROTOCOL_VERSION,
  compareVersions,
  friendlyError,
  normalizeSerial,
  parseDetectResponse,
  parseInfoResponse,
  parseReadResponse,
  parseWriteResponse
} from '../protocol.js';

for (const input of [
  '11 22 33 44 55 66',
  '112233445566',
  '11.22.33.44.55.66',
  '11:22:33:44:55:66',
  '11-22-33-44-55-66'
]) {
  test(`normalizes ${input}`, () => {
    assert.equal(normalizeSerial(input), '11 22 33 44 55 66');
  });
}

test('rejects incomplete serials', () => {
  assert.throws(() => normalizeSerial('11 22'), /exactly 6 bytes/);
});

test('compares firmware versions', () => {
  assert.equal(compareVersions('0.4.0', MINIMUM_FIRMWARE_VERSION), 0);
  assert.equal(compareVersions('0.3.9', MINIMUM_FIRMWARE_VERSION), -1);
  assert.equal(compareVersions('0.4.1', MINIMUM_FIRMWARE_VERSION), 1);
});

test('parses product information', () => {
  assert.deepEqual(
    parseInfoResponse('OK INFO PRODUCT=IBUTTON_PROGRAMMER FW=0.4.0 PROTO=3 BOARD=NANO328P'),
    { firmware: '0.4.0', protocol: SUPPORTED_PROTOCOL_VERSION, board: SUPPORTED_BOARD }
  );
});

test('rejects a foreign product response', () => {
  assert.throws(() => parseInfoResponse('OK INFO PRODUCT=OTHER FW=0.4.0 PROTO=3 BOARD=NANO328P'));
});

test('parses read, detect, and write responses', () => {
  assert.equal(parseReadResponse('OK READ 11 22 33 44 55 66'), '11 22 33 44 55 66');
  assert.equal(parseDetectResponse('OK DETECT TYPE=RW1990V1'), 'RW1990V1');
  assert.deepEqual(parseWriteResponse('OK WRITE TYPE=RW1990V2'), { unchanged: false, type: 'RW1990V2' });
  assert.deepEqual(parseWriteResponse('OK WRITE STATUS=UNCHANGED'), { unchanged: true, type: null });
});

test('rejects unsupported detected and written types', () => {
  assert.throws(() => parseDetectResponse('OK DETECT TYPE=RW2004'));
  assert.throws(() => parseWriteResponse('OK WRITE TYPE=TM01'));
});

test('maps safety-related errors to explicit messages', () => {
  assert.match(friendlyError('BUTTON_REMOVED_BEFORE_WRITE'), /No serial number was written/);
  assert.match(friendlyError('WRITE_INTERRUPTED'), /incomplete code/);
  assert.match(friendlyError('VERIFY_FAILED'), /Do not use/);
});
