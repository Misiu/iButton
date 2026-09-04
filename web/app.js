const BAUD_RATE = 9600;
const INFO_TIMEOUT_MS = 1500;
const READ_TIMEOUT_MS = 6500;
const WRITE_TIMEOUT_MS = 10000;

const connectButton = document.querySelector('#connect');
const readButton = document.querySelector('#read');
const writeButton = document.querySelector('#write');
const clearLogButton = document.querySelector('#clear-log');
const copyLogButton = document.querySelector('#copy-log');
const protocolLog = document.querySelector('#protocol-log');
const serialFields = [...document.querySelectorAll('.serial-byte')];
const serialFieldsContainer = document.querySelector('#serial-fields');
const programmer = document.querySelector('#programmer');
const status = document.querySelector('#status');
const message = document.querySelector('#message');

let port;
let reader;
let receiveBuffer = '';
let deviceInfo = null;

function logProtocol(direction, value) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  protocolLog.textContent += `[${time}] ${direction} ${value || '<empty>'}\n`;
  protocolLog.scrollTop = protocolLog.scrollHeight;
}

function normalizeSerial(value) {
  const hex = value.toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) throw new Error('The serial number must contain exactly 6 bytes.');
  return hex.match(/../g).join(' ');
}
function getSerial() { return normalizeSerial(serialFields.map(field => field.value).join('')); }
function setSerial(value) { const bytes = normalizeSerial(value).split(' '); serialFields.forEach((field, index) => { field.value = bytes[index]; }); }
function isProtocolResponse(line) { const value = line.trim(); return value.startsWith('OK ') || value === 'OK' || value.startsWith('ERROR '); }
function parseDeviceError(line) { const value = line.trim(); return value.startsWith('ERROR ') ? value.slice(6).trim() || 'iButton operation failed.' : value; }
function parseReadResponse(line) {
  if (line.startsWith('ERROR ')) throw new Error(parseDeviceError(line));
  const match = /^OK READ ((?:[0-9A-F]{2} ){5}[0-9A-F]{2})$/i.exec(line.trim());
  if (!match) throw new Error(`Invalid device response: ${line}`);
  return match[1].toUpperCase();
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
    if (field.value.length === 2 && index < serialFields.length - 1) { serialFields[index + 1].focus(); serialFields[index + 1].select(); }
  });
  field.addEventListener('keydown', event => {
    if (event.key === 'Backspace' && field.value.length === 0 && index > 0) { event.preventDefault(); const previous = serialFields[index - 1]; previous.focus(); previous.setSelectionRange(previous.value.length, previous.value.length); }
    if (event.key === 'ArrowLeft' && field.selectionStart === 0 && index > 0) { event.preventDefault(); serialFields[index - 1].focus(); }
    if (event.key === 'ArrowRight' && field.selectionStart === field.value.length && index < serialFields.length - 1) { event.preventDefault(); serialFields[index + 1].focus(); }
  });
  field.addEventListener('focus', () => field.select());
});
serialFieldsContainer.addEventListener('paste', event => { event.preventDefault(); distributeHex(event.clipboardData.getData('text'), Math.max(0, serialFields.indexOf(document.activeElement))); });
clearLogButton.addEventListener('click', () => { protocolLog.textContent = ''; });
copyLogButton.addEventListener('click', async () => { try { await navigator.clipboard.writeText(protocolLog.textContent); const original = copyLogButton.textContent; copyLogButton.textContent = 'Copied'; setTimeout(() => { copyLogButton.textContent = original; }, 1200); } catch { message.className = 'message error'; message.textContent = 'Could not copy the protocol log.'; } });

async function writeText(text) {
  if (!port?.writable) throw new Error('The programmer is not connected.');
  logProtocol('TX  ', text);
  const writer = port.writable.getWriter();
  try { await writer.write(new TextEncoder().encode(`${text}\n`)); } finally { writer.releaseLock(); }
}
async function readProtocolResponse(timeoutMs) {
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
      }
      const remaining = deadline - Date.now();
      const result = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for the programmer.')), remaining))]);
      if (result.done) throw new Error('Connection to the programmer was interrupted.');
      receiveBuffer += decoder.decode(result.value, { stream: true });
    }
    throw new Error('Timed out waiting for a response.');
  } finally { reader.releaseLock(); reader = undefined; }
}
async function command(text, timeoutMs) { receiveBuffer = ''; await writeText(text); return await readProtocolResponse(timeoutMs); }

async function identifyProgrammer() {
  const response = await command('INFO', INFO_TIMEOUT_MS);
  const match = /^OK INFO PRODUCT=IBUTTON_PROGRAMMER FW=([^ ]+) PROTO=([^ ]+) BOARD=([^ ]+)$/i.exec(response);
  if (!match) throw new Error('The connected device is not a supported iButton Programmer.');
  if (match[2] !== '3') throw new Error(`Unsupported programmer protocol version: ${match[2]}.`);
  deviceInfo = { firmware: match[1], protocol: match[2], board: match[3] };
  logProtocol('INFO', `programmer firmware=${deviceInfo.firmware} protocol=${deviceInfo.protocol}`);
}

async function connect() {
  if (!('serial' in navigator)) throw new Error('This browser does not support Web Serial. Use a compatible Chromium-based desktop browser.');
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  receiveBuffer = '';
  const info = port.getInfo?.() ?? {};
  logProtocol('INFO', `connected baud=${BAUD_RATE} usbVendorId=${info.usbVendorId ?? 'n/a'} usbProductId=${info.usbProductId ?? 'n/a'}`);
  await new Promise(resolve => setTimeout(resolve, 400));
  await identifyProgrammer();
  setConnected(true);
}
async function disconnect() { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; } if (port) await port.close().catch(() => {}); port = undefined; deviceInfo = null; receiveBuffer = ''; logProtocol('INFO', 'disconnected'); setConnected(false); }
function setConnected(connected) { programmer.hidden = !connected; status.textContent = connected ? 'Connected' : 'Disconnected'; status.className = `status ${connected ? 'connected' : 'disconnected'}`; connectButton.textContent = connected ? 'Disconnect device' : 'Connect device'; }
async function runBusy(fn) { readButton.disabled = true; writeButton.disabled = true; message.className = 'message'; message.textContent = ''; try { await fn(); } catch (error) { logProtocol('ERR ', error.message ?? String(error)); message.className = 'message error'; message.textContent = error.message ?? String(error); } finally { readButton.disabled = false; writeButton.disabled = false; } }

connectButton.addEventListener('click', async () => { try { if (port) await disconnect(); else await connect(); } catch (error) { if (port) await disconnect().catch(() => {}); message.className = 'message error'; message.textContent = error.message ?? String(error); } });
readButton.addEventListener('click', () => runBusy(async () => { message.textContent = 'Touch an iButton to the reader...'; const response = await command('READ', READ_TIMEOUT_MS); setSerial(parseReadResponse(response)); message.className = 'message success'; message.textContent = 'Serial number read successfully.'; }));
writeButton.addEventListener('click', () => runBusy(async () => { const normalized = getSerial(); setSerial(normalized); message.textContent = 'Touch a writable iButton to the reader...'; const response = await command(`WRITE ${normalized}`, WRITE_TIMEOUT_MS); if (response.startsWith('ERROR ')) throw new Error(parseDeviceError(response)); if (!response.startsWith('OK WRITE')) throw new Error(response || 'Failed to write the serial number.'); message.className = 'message success'; message.textContent = 'Serial number written and verified successfully.'; }));
navigator.serial?.addEventListener('disconnect', event => { if (event.target === port) { port = undefined; deviceInfo = null; receiveBuffer = ''; setConnected(false); logProtocol('INFO', 'device disconnected'); message.className = 'message error'; message.textContent = 'The programmer was disconnected.'; } });
