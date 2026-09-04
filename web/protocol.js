export const SUPPORTED_PROTOCOL_VERSION = '3';
export const SUPPORTED_BOARD = 'NANO328P';
export const MINIMUM_FIRMWARE_VERSION = '0.4.0';

export function normalizeSerial(value) {
  const hex = String(value).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) {
    throw new Error('The serial number must contain exactly 6 bytes.');
  }
  return hex.match(/../g).join(' ');
}

export function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value));
    return match ? match.slice(1).map(Number) : null;
  };

  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error('Invalid firmware version.');

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function isProtocolResponse(line) {
  const value = String(line).trim();
  return value === 'OK' || value.startsWith('OK ') || value.startsWith('ERROR ');
}

export function parseInfoResponse(line) {
  const match = /^OK INFO PRODUCT=IBUTTON_PROGRAMMER FW=([^ ]+) PROTO=([^ ]+) BOARD=([^ ]+)$/i.exec(String(line).trim());
  if (!match) throw new Error('The connected device is not a supported iButton Programmer.');
  return { firmware: match[1], protocol: match[2], board: match[3].toUpperCase() };
}

export function parseReadResponse(line) {
  const value = String(line).trim();
  if (value.startsWith('ERROR ')) throw new Error(parseErrorCode(value));

  const match = /^OK READ ((?:[0-9A-F]{2} ){5}[0-9A-F]{2})$/i.exec(value);
  if (!match) throw new Error(`Invalid device response: ${value}`);
  return match[1].toUpperCase();
}

export function parseDetectResponse(line) {
  const value = String(line).trim();
  if (value.startsWith('ERROR ')) throw new Error(parseErrorCode(value));

  const match = /^OK DETECT TYPE=(RW1990V1|RW1990V2)$/i.exec(value);
  if (!match) throw new Error(`Invalid device response: ${value}`);
  return match[1].toUpperCase();
}

export function parseWriteResponse(line) {
  const value = String(line).trim();
  if (value.startsWith('ERROR ')) throw new Error(parseErrorCode(value));
  if (value === 'OK WRITE STATUS=UNCHANGED') return { unchanged: true, type: null };

  const match = /^OK WRITE TYPE=(RW1990V1|RW1990V2)$/i.exec(value);
  if (!match) throw new Error(`Invalid device response: ${value}`);
  return { unchanged: false, type: match[1].toUpperCase() };
}

export function parseErrorCode(line) {
  const value = String(line).trim();
  return value.startsWith('ERROR ') ? value.slice(6).trim() : value;
}

const FRIENDLY_ERRORS = {
  NO_BUTTON: 'No iButton was detected. Try again and keep it firmly on the reader.',
  ROM_CRC: 'The iButton response failed its checksum. Clean the contacts, hold it firmly, and try again.',
  INVALID_BUTTON_DATA: 'The iButton returned invalid data. Clean the contacts, hold it firmly, and try again.',
  UNSTABLE_CONTACT: 'The iButton contact was unstable. Hold it firmly on the reader and try again.',
  UNSUPPORTED_FAMILY: 'This device is not a supported DS1990/RW1990-family iButton.',
  INVALID_SERIAL: 'Enter a complete 6-byte serial number.',
  INVALID_ARGUMENT: 'The programmer received an invalid command.',
  NOT_WRITABLE_OR_UNSUPPORTED: 'This iButton is read-only or is not a supported RW1990 type. No serial number was written.',
  UNSUPPORTED_TYPE: 'This writable iButton type is not supported. No serial number was written.',
  BUTTON_REMOVED: 'The iButton lost contact during detection. Hold it firmly on the reader and try again.',
  BUTTON_REMOVED_BEFORE_WRITE: 'The iButton lost contact before programming started. No serial number was written.',
  UNSTABLE_CONTACT_BEFORE_WRITE: 'The contact became unstable before programming started. No serial number was written.',
  BUTTON_CHANGED: 'A different iButton was detected before programming. No serial number was written.',
  WRITE_INTERRUPTED: 'Contact was lost while programming. The iButton may contain an incomplete code. Do not use it until it has been read and rewritten successfully.',
  WRITE_FAILED: 'Programming did not complete. The iButton may contain an incomplete code. Do not use it until it has been read and rewritten successfully.',
  VERIFY_READ_FAILED: 'Programming ran, but the iButton could not be read back reliably. Keep it aside and verify its serial number before use.',
  VERIFY_FAILED: 'The serial number read back after programming did not match. Do not use this iButton until it has been rewritten and verified.',
  UNKNOWN_COMMAND: 'The programmer received an unsupported command.',
  LINE_TOO_LONG: 'The programmer received an invalid command.'
};

export function friendlyError(code) {
  const normalized = String(code).trim().split(/\s+/)[0];
  return FRIENDLY_ERRORS[normalized] ?? `Programmer error: ${code}`;
}
