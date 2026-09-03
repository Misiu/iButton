const BAUD_RATE = 9600;
const RESPONSE_TIMEOUT_MS = 15000;

const connectButton = document.querySelector('#connect');
const readButton = document.querySelector('#read');
const writeButton = document.querySelector('#write');
const clearLogButton = document.querySelector('#clear-log');
const protocolLog = document.querySelector('#protocol-log');
const serialFields = [...document.querySelectorAll('.serial-byte')];
const serialFieldsContainer = document.querySelector('#serial-fields');
const programmer = document.querySelector('#programmer');
const status = document.querySelector('#status');
const message = document.querySelector('#message');

let port;
let reader;
let receiveBuffer = '';

function logProtocol(direction, value) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const text = typeof value === 'string'
    ? value
    : [...value].map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  protocolLog.textContent += `[${time}] ${direction} ${text || '<empty>'}\n`;
  protocolLog.scrollTop = protocolLog.scrollHeight;
}

function additiveChecksum(bytes) {
  return bytes.reduce((sum, value) => (sum + value) & 0xff, 0);
}

function dallasCrc8(bytes) {
  let crc = 0;
  for (const value of bytes) {
    let inByte = value;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ inByte) & 0x01;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      inByte >>= 1;
    }
  }
  return crc;
}

function normalizeSerial(value) {
  const hex = value.toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) throw new Error('The serial number must contain exactly 6 bytes.');
  return hex.match(/../g).join(' ');
}

function getSerial() { return normalizeSerial(serialFields.map(field => field.value).join('')); }
function setSerial(value) {
  const bytes = normalizeSerial(value).split(' ');
  serialFields.forEach((field, index) => { field.value = bytes[index]; });
}

function serialToRom(value) {
  const serial = normalizeSerial(value).split(' ').map(v => Number.parseInt(v, 16));
  const rom = [0x01, ...serial.reverse()];
  rom.push(dallasCrc8(rom));
  return rom;
}

function buildReadCommand() {
  const command = [0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0];
  command.push(additiveChecksum(command));
  return new Uint8Array(command);
}

function buildWriteCommand(serial) {
  const command = [0x00, 0x01, ...serialToRom(serial)];
  command.push(additiveChecksum(command));
  return new Uint8Array(command);
}

function isRomResponse(line) {
  const tokens = line.trim().split(/\s+/);
  return tokens.length === 8 && tokens.every(x => /^[0-9a-fA-F]{2}$/.test(x));
}

function isProtocolResponse(line) {
  const value = line.trim();
  return value === 'OK' || value === 'ERROR' || value.startsWith('ERROR ') || value.startsWith('ERROR:') || isRomResponse(value);
}

function parseDeviceError(line) {
  const value = line.trim();
  if (value === 'ERROR') return 'iButton operation failed.';
  if (value.startsWith('ERROR:')) return value.slice(6).trim() || 'iButton operation failed.';
  if (value.startsWith('ERROR ')) return value.slice(6).trim() || 'iButton operation failed.';
  return value;
}

function parseReadResponse(line) {
  if (line.trim().startsWith('ERROR')) throw new Error(parseDeviceError(line));
  if (!isRomResponse(line)) throw new Error(`Invalid device response: ${line}`);
  const tokens = line.trim().split(/\s+/);
  return tokens.slice(1, 7).reverse().join(' ').toUpperCase();
}

function distributeHex(text, startIndex = 0) {
  const hex = text.toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!hex) return;
  let position = 0;
  for (let index = startIndex; index < serialFields.length && position < hex.length; index++) {
    serialFields[index].value = hex.slice(position, position + 2);
    position += 2;
  }
  const used = Math.ceil(Math.min(hex.length, (serialFields.length - startIndex) * 2) / 2);
  const focusIndex = Math.min(startIndex + used, serialFields.length - 1);
  serialFields[focusIndex].focus();
  serialFields[focusIndex].select();
}

serialFields.forEach((field, index) => {
  field.addEventListener('input', () => {
    const hex = field.value.toUpperCase().replace(/[^0-9A-F]/g, '');
    field.value = hex.slice(0, 2);
    if (field.value.length === 2 && index < serialFields.length - 1) {
      serialFields[index + 1].focus();
      serialFields[index + 1].select();
    }
  });
  field.addEventListener('keydown', event => {
    if (event.key === 'Backspace' && field.value.length === 0 && index > 0) {
      event.preventDefault();
      const previous = serialFields[index - 1];
      previous.focus();
      previous.setSelectionRange(previous.value.length, previous.value.length);
    }
    if (event.key === 'ArrowLeft' && field.selectionStart === 0 && index > 0) {
      event.preventDefault();
      serialFields[index - 1].focus();
    }
    if (event.key === 'ArrowRight' && field.selectionStart === field.value.length && index < serialFields.length - 1) {
      event.preventDefault();
      serialFields[index + 1].focus();
    }
  });
  field.addEventListener('focus', () => field.select());
});

serialFieldsContainer.addEventListener('paste', event => {
  event.preventDefault();
  const activeIndex = Math.max(0, serialFields.indexOf(document.activeElement));
  distributeHex(event.clipboardData.getData('text'), activeIndex);
});

clearLogButton.addEventListener('click', () => { protocolLog.textContent = ''; });

async function connect() {
  if (!('serial' in navigator)) throw new Error('This browser does not support Web Serial. Use a compatible Chromium-based desktop browser.');
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  receiveBuffer = '';
  const info = port.getInfo?.() ?? {};
  logProtocol('INFO', `connected baud=${BAUD_RATE} usbVendorId=${info.usbVendorId ?? 'n/a'} usbProductId=${info.usbProductId ?? 'n/a'}`);
  setConnected(true);
}

async function disconnect() {
  if (reader) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    reader = undefined;
  }
  if (port) await port.close().catch(() => {});
  port = undefined;
  receiveBuffer = '';
  logProtocol('INFO', 'disconnected');
  setConnected(false);
}

function setConnected(connected) {
  programmer.hidden = !connected;
  status.textContent = connected ? 'Connected' : 'Disconnected';
  status.className = `status ${connected ? 'connected' : 'disconnected'}`;
  connectButton.textContent = connected ? 'Disconnect device' : 'Connect device';
}

async function writeBytes(bytes) {
  if (!port?.writable) throw new Error('The programmer is not connected.');
  logProtocol('TX  ', bytes);
  const writer = port.writable.getWriter();
  try { await writer.write(bytes); } finally { writer.releaseLock(); }
}

async function readProtocolResponse(timeoutMs = RESPONSE_TIMEOUT_MS) {
  if (!port?.readable) throw new Error('The programmer is not connected.');
  const decoder = new TextDecoder();
  reader = port.readable.getReader();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      while (true) {
        const newline = receiveBuffer.search(/[\r\n]/);
        if (newline < 0) break;
        const line = receiveBuffer.slice(0, newline).trim();
        receiveBuffer = receiveBuffer.slice(newline).replace(/^[\r\n]+/, '');
        if (!line) continue;
        logProtocol('RX  ', line);
        if (isProtocolResponse(line)) return line;
        logProtocol('SKIP', 'non-protocol startup/debug line');
      }

      const remaining = deadline - Date.now();
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for an iButton.')), remaining))
      ]);
      if (result.done) throw new Error('Connection to the programmer was interrupted.');
      receiveBuffer += decoder.decode(result.value, { stream: true });
    }
    throw new Error('Timed out waiting for a response.');
  } finally {
    reader.releaseLock();
    reader = undefined;
  }
}

async function command(bytes) {
  await writeBytes(bytes);
  return await readProtocolResponse();
}

async function runBusy(fn) {
  readButton.disabled = true;
  writeButton.disabled = true;
  message.className = 'message';
  message.textContent = '';
  try { await fn(); }
  catch (error) {
    logProtocol('ERR ', error.message ?? String(error));
    message.className = 'message error';
    message.textContent = error.message ?? String(error);
  } finally {
    readButton.disabled = false;
    writeButton.disabled = false;
  }
}

connectButton.addEventListener('click', async () => {
  try {
    if (port) await disconnect();
    else await connect();
  } catch (error) {
    message.className = 'message error';
    message.textContent = error.message ?? String(error);
  }
});

readButton.addEventListener('click', () => runBusy(async () => {
  message.textContent = 'Touch an iButton to the reader...';
  const response = await command(buildReadCommand());
  setSerial(parseReadResponse(response));
  message.className = 'message success';
  message.textContent = 'Serial number read successfully.';
}));

writeButton.addEventListener('click', () => runBusy(async () => {
  const normalized = getSerial();
  setSerial(normalized);
  message.textContent = 'Touch a writable iButton to the reader...';
  const response = await command(buildWriteCommand(normalized));
  if (response.startsWith('ERROR')) throw new Error(parseDeviceError(response));
  if (response !== 'OK') throw new Error(response || 'Failed to write the serial number.');
  message.className = 'message success';
  message.textContent = 'Serial number written successfully.';
}));

navigator.serial?.addEventListener('disconnect', event => {
  if (event.target === port) {
    port = undefined;
    receiveBuffer = '';
    setConnected(false);
    logProtocol('INFO', 'device disconnected');
    message.className = 'message error';
    message.textContent = 'The programmer was disconnected.';
  }
});
