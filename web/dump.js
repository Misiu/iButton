const FLASH_SIZE = 32768;
const PAGE_SIZE = 128;
const BAUD_RATES = [115200, 57600];
const STK_OK = 0x10;
const STK_INSYNC = 0x14;
const CRC_EOP = 0x20;
const STK_GET_SYNC = 0x30;
const STK_READ_SIGN = 0x75;
const STK_LOAD_ADDRESS = 0x55;
const STK_READ_PAGE = 0x74;

const connectButton = document.querySelector('#connect');
const dumpButton = document.querySelector('#dump');
const downloadBinButton = document.querySelector('#download-bin');
const downloadHexButton = document.querySelector('#download-hex');
const status = document.querySelector('#status');
const message = document.querySelector('#message');
const logElement = document.querySelector('#log');
const progressBar = document.querySelector('#progress-bar');
const meta = document.querySelector('#meta');
const baudElement = document.querySelector('#baud');
const signatureElement = document.querySelector('#signature');
const dumpedElement = document.querySelector('#dumped');

let port;
let reader;
let rx = [];
let selectedBaud;
let flashDump;

function hexByte(v) { return v.toString(16).padStart(2, '0').toUpperCase(); }
function log(text) {
  logElement.textContent += `${new Date().toLocaleTimeString([], { hour12: false })} ${text}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}
function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `dump-status ${type}`.trim();
}
function setConnected(value) {
  status.textContent = value ? 'Bootloader connected' : 'Disconnected';
  status.className = `status ${value ? 'connected' : 'disconnected'}`;
  dumpButton.disabled = !value;
}

async function closePort() {
  if (reader) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    reader = undefined;
  }
  if (port) await port.close().catch(() => {});
  port = undefined;
  rx = [];
}

async function openAt(baud) {
  await closePort();
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  rx = [];
  log(`Opened at ${baud} baud`);
}

async function reopenAt(baud) {
  if (reader) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    reader = undefined;
  }
  if (port) await port.close().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 150));
  await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  rx = [];
  log(`Reopened at ${baud} baud`);
}

async function resetNano() {
  // Arduino Nano USB-serial adapters normally reset the ATmega through DTR.
  await port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 100));
  await port.setSignals({ dataTerminalReady: true, requestToSend: false }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 350));
  await port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 100));
  rx = [];
}

async function write(bytes) {
  const data = new Uint8Array(bytes);
  log(`TX ${[...data].map(hexByte).join(' ')}`);
  const writer = port.writable.getWriter();
  try { await writer.write(data); } finally { writer.releaseLock(); }
}

async function readBytes(count, timeoutMs = 1200) {
  if (!reader) reader = port.readable.getReader();
  const deadline = Date.now() + timeoutMs;
  while (rx.length < count) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timeout waiting for ${count} bytes (received ${rx.length}).`);
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout waiting for ${count} bytes (received ${rx.length}).`)), remaining))
    ]);
    if (result.done) throw new Error('Serial connection closed.');
    rx.push(...result.value);
  }
  const out = rx.splice(0, count);
  log(`RX ${out.map(hexByte).join(' ')}`);
  return out;
}

async function drainInput(ms = 80) {
  if (!port?.readable) return;
  if (!reader) reader = port.readable.getReader();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('done')), 20))
      ]);
      if (result.done) break;
      if (result.value?.length) log(`RX-DRAIN ${[...result.value].map(hexByte).join(' ')}`);
    } catch { break; }
  }
  rx = [];
}

async function command(bytes, payloadLength = 0, timeoutMs = 1200) {
  await write([...bytes, CRC_EOP]);
  const first = await readBytes(1, timeoutMs);
  if (first[0] !== STK_INSYNC) throw new Error(`Expected STK_INSYNC 14, got ${hexByte(first[0])}.`);
  const payload = payloadLength ? await readBytes(payloadLength, timeoutMs) : [];
  const last = await readBytes(1, timeoutMs);
  if (last[0] !== STK_OK) throw new Error(`Expected STK_OK 10, got ${hexByte(last[0])}.`);
  return payload;
}

async function sync() {
  await drainInput();
  for (let i = 0; i < 5; i++) {
    try {
      const reply = await command([STK_GET_SYNC], 0, 700);
      return reply;
    } catch (error) {
      log(`Sync attempt ${i + 1} failed: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      rx = [];
    }
  }
  throw new Error('Nano bootloader did not answer STK500v1 sync.');
}

async function detect() {
  if (!('serial' in navigator)) throw new Error('Web Serial is not available. Use Chrome or Edge.');
  setMessage('Select the Arduino Nano serial port...');
  port = await navigator.serial.requestPort();

  let lastError;
  for (const baud of BAUD_RATES) {
    try {
      if (port.readable || port.writable) await port.close().catch(() => {});
      await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      log(`Trying Nano bootloader at ${baud} baud`);
      await resetNano();
      await sync();
      const signature = await command([STK_READ_SIGN], 3);
      const signatureText = signature.map(hexByte).join(' ');
      log(`Signature ${signatureText}`);
      if (signatureText !== '1E 95 0F') log('WARNING: signature is not ATmega328P (1E 95 0F)');
      selectedBaud = baud;
      baudElement.textContent = String(baud);
      signatureElement.textContent = signatureText;
      meta.hidden = false;
      setConnected(true);
      setMessage(`Bootloader detected at ${baud} baud.`, 'success');
      return;
    } catch (error) {
      lastError = error;
      log(`${baud} baud failed: ${error.message}`);
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        reader = undefined;
      }
      await port.close().catch(() => {});
      rx = [];
    }
  }
  setConnected(false);
  throw new Error(`Could not detect Nano bootloader at 115200 or 57600 baud. ${lastError?.message ?? ''}`);
}

async function ensureBootloader() {
  if (!port) throw new Error('Connect the Nano first.');
  if (!port.readable || !port.writable) await port.open({ baudRate: selectedBaud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  await resetNano();
  await sync();
}

async function readFlash() {
  dumpButton.disabled = true;
  connectButton.disabled = true;
  downloadBinButton.disabled = true;
  downloadHexButton.disabled = true;
  flashDump = undefined;
  progressBar.style.width = '0%';
  dumpedElement.textContent = '0 bytes';
  try {
    setMessage('Resetting Nano and entering bootloader...');
    await ensureBootloader();
    const data = new Uint8Array(FLASH_SIZE);
    for (let address = 0; address < FLASH_SIZE; address += PAGE_SIZE) {
      const wordAddress = address >> 1;
      await command([STK_LOAD_ADDRESS, wordAddress & 0xff, (wordAddress >> 8) & 0xff]);
      const block = await command([STK_READ_PAGE, 0x00, PAGE_SIZE, 0x46], PAGE_SIZE, 1600);
      data.set(block, address);
      const done = address + PAGE_SIZE;
      progressBar.style.width = `${(done / FLASH_SIZE) * 100}%`;
      dumpedElement.textContent = `${done} bytes`;
      setMessage(`Reading flash: ${done} / ${FLASH_SIZE} bytes...`);
    }
    flashDump = data;
    downloadBinButton.disabled = false;
    downloadHexButton.disabled = false;
    setMessage('Flash read completed. Download BIN and HEX before disconnecting.', 'success');
    log('Flash dump completed successfully');
  } catch (error) {
    log(`ERROR ${error.message}`);
    setMessage(error.message, 'error');
  } finally {
    dumpButton.disabled = false;
    connectButton.disabled = false;
  }
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function intelHex(data) {
  const lines = [];
  for (let address = 0; address < data.length; address += 16) {
    const chunk = [...data.slice(address, address + 16)];
    const record = [chunk.length, (address >> 8) & 0xff, address & 0xff, 0x00, ...chunk];
    const checksum = (-record.reduce((sum, b) => sum + b, 0)) & 0xff;
    lines.push(`:${record.map(hexByte).join('')}${hexByte(checksum)}`);
  }
  lines.push(':00000001FF');
  return `${lines.join('\n')}\n`;
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  dumpButton.disabled = true;
  setConnected(false);
  flashDump = undefined;
  downloadBinButton.disabled = true;
  downloadHexButton.disabled = true;
  try { await closePort(); await detect(); }
  catch (error) { log(`ERROR ${error.message}`); setMessage(error.message, 'error'); }
  finally { connectButton.disabled = false; }
});

dumpButton.addEventListener('click', readFlash);
downloadBinButton.addEventListener('click', () => flashDump && download('nano-firmware.bin', new Blob([flashDump], { type: 'application/octet-stream' })));
downloadHexButton.addEventListener('click', () => flashDump && download('nano-firmware.hex', new Blob([intelHex(flashDump)], { type: 'text/plain' })));
