import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntelHex } from '../intel-hex.js';

test('parses and pads valid Intel HEX data', () => {
  const parsed = parseIntelHex(':0400000001020304F2\n:00000001FF\n', { maximumSize: 8 });
  assert.equal(parsed.usedLength, 4);
  assert.deepEqual([...parsed.image], [1, 2, 3, 4, 255, 255, 255, 255]);
});

test('rejects invalid checksums', () => {
  assert.throws(() => parseIntelHex(':0400000001020304F3\n:00000001FF\n'), /checksum/);
});

test('rejects missing EOF', () => {
  assert.throws(() => parseIntelHex(':0400000001020304F2\n'), /end-of-file/);
});

test('rejects data after EOF', () => {
  assert.throws(
    () => parseIntelHex(':020000000102FB\n:00000001FF\n:0100020003FA\n'),
    /after the end-of-file/
  );
});

test('rejects firmware beyond the application area', () => {
  assert.throws(
    () => parseIntelHex(':01000800AA4D\n:00000001FF\n', { maximumSize: 8 }),
    /application area/
  );
});

test('requires an AVR reset vector', () => {
  assert.throws(
    () => parseIntelHex(':020010000102EB\n:00000001FF\n', { maximumSize: 32 }),
    /reset vector/
  );
});
