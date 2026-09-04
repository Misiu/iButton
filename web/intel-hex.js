export function parseIntelHex(text, { maximumSize = 30720 } = {}) {
  if (!Number.isInteger(maximumSize) || maximumSize <= 0) {
    throw new Error('Invalid firmware size limit.');
  }

  const memory = new Map();
  let upperAddress = 0;
  let sawEndOfFile = false;

  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    if (sawEndOfFile) {
      throw new Error(`Unexpected Intel HEX data after the end-of-file record on line ${index + 1}.`);
    }
    if (!/^:[0-9A-Fa-f]+$/.test(line)) {
      throw new Error(`Invalid Intel HEX syntax on line ${index + 1}.`);
    }

    const byteCount = Number.parseInt(line.slice(1, 3), 16);
    if (line.length !== 11 + byteCount * 2) {
      throw new Error(`Invalid Intel HEX record length on line ${index + 1}.`);
    }

    const bytes = [];
    for (let offset = 1; offset < line.length; offset += 2) {
      bytes.push(Number.parseInt(line.slice(offset, offset + 2), 16));
    }
    if ((bytes.reduce((sum, value) => sum + value, 0) & 0xff) !== 0) {
      throw new Error(`Invalid Intel HEX checksum on line ${index + 1}.`);
    }

    const address = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];

    if (recordType === 0x00) {
      const absoluteAddress = upperAddress + address;
      for (let i = 0; i < byteCount; i += 1) {
        const targetAddress = absoluteAddress + i;
        if (targetAddress >= maximumSize) {
          throw new Error(`Firmware exceeds the Nano application area at address 0x${targetAddress.toString(16).toUpperCase()}.`);
        }

        const value = bytes[4 + i];
        const existing = memory.get(targetAddress);
        if (existing !== undefined && existing !== value) {
          throw new Error(`Conflicting Intel HEX data at address 0x${targetAddress.toString(16).toUpperCase()}.`);
        }
        memory.set(targetAddress, value);
      }
    } else if (recordType === 0x01) {
      if (byteCount !== 0 || address !== 0) {
        throw new Error(`Invalid Intel HEX end-of-file record on line ${index + 1}.`);
      }
      sawEndOfFile = true;
    } else if (recordType === 0x04) {
      if (byteCount !== 2 || address !== 0) {
        throw new Error(`Invalid Intel HEX extended-address record on line ${index + 1}.`);
      }
      upperAddress = (((bytes[4] << 8) | bytes[5]) << 16) >>> 0;
    } else if (recordType === 0x03 || recordType === 0x05) {
      if (byteCount !== 4 || address !== 0) {
        throw new Error(`Invalid Intel HEX start-address record on line ${index + 1}.`);
      }
      // Start-address metadata is not used by the AVR serial bootloader.
    } else {
      throw new Error(`Unsupported Intel HEX record type ${recordType.toString(16).padStart(2, '0').toUpperCase()} on line ${index + 1}.`);
    }
  }

  if (!sawEndOfFile) throw new Error('Intel HEX end-of-file record is missing.');
  if (!memory.size) throw new Error('Firmware contains no application data.');
  if (!memory.has(0) || !memory.has(1) || (memory.get(0) === 0xff && memory.get(1) === 0xff)) {
    throw new Error('Firmware does not contain a valid AVR reset vector.');
  }

  const usedLength = Math.max(...memory.keys()) + 1;
  const image = new Uint8Array(maximumSize).fill(0xff);
  for (const [address, value] of memory) image[address] = value;

  return { image, usedLength };
}
