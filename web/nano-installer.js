import { parseIntelHex } from './intel-hex.js';

const installButton = document.querySelector('#install');
const openProgrammerLink = document.querySelector('#open-programmer');
const logElement = document.querySelector('#install-log');
const statusElement = document.querySelector('#install-status');
const progressElement = document.querySelector('#install-progress');

const BAUD_RATES = [115200, 57600];
const PAGE_SIZE = 128;
const MAX_APPLICATION_SIZE = 30720;
const EXPECTED_SIGNATURE = [0x1e, 0x95, 0x0f];
const EXPECTED_PROTOCOL = '3';

const STK_OK = 0x10;
const STK_INSYNC = 0x14;
const CRC_EOP = 0x20;
const STK_GET_SYNC = 0x30;
const STK_ENTER_PROGMODE = 0x50;
const STK_LEAVE_PROGMODE = 0x51;
const STK_LOAD_ADDRESS = 0x55;
const STK_PROG_PAGE = 0x64;
const STK_READ_PAGE = 0x74;
const STK_READ_SIGN = 0x75;
const MEMORY_FLASH = 0x46;

let port;
let reader;
let readLoopPromise;
let readFailure;
let receiveBuffer = [];
let dataWaiters = [];
let installing = false;
let closing = false;

class WrongDeviceError extends Error {}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hexByte(value) {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function writeLog(text) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  logElement.textContent += `[${time}] ${text}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}

function setStatus(text, type = '') {
  statusElement.textContent = text;
  statusElement.className = `install-status${type ? ` ${type}` : ''}`;
}

function setProgress(value) {
  const clamped = Math.max(0, Math.min(100, value));
  progressElement.style.width = `${clamped}%`;
  progressElement.parentElement.setAttribute('aria-valuenow', String(Math.round(clamped)));
}

function setInstalling(value) {
  installing = value;
  installButton.disabled = value;
  installButton.setAttribute('aria-busy', value ? 'true' : 'false');
  installButton.textContent = value ? 'Installing…' : 'Install firmware';
  openProgrammerLink.classList.toggle('disabled-link', value);
  openProgrammerLink.setAttribute('aria-disabled', value ? 'true' : 'false');
  openProgrammerLink.tabIndex = value ? -1 : 0;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(hexByte).join('').toLowerCase();
}

async function setSignalsTwice(signals) {
  await port.setSignals(signals).catch(() => {});
  await port.setSignals(signals).catch(() => {});
}

async function resetNano() {
  writeLog('Resetting Arduino Nano through DTR...');
  await setSignalsTwice({ dataTerminalReady: false, requestToSend: false });
  await sleep(80);
  await setSignalsTwice({ dataTerminalReady: true, requestToSend: false });
  await sleep(80);
  await setSignalsTwice({ dataTerminalReady: false, requestToSend: false });
  await sleep(180);
  receiveBuffer = [];
}

function notifyDataWaiters() {
  const waiters = dataWaiters;
  dataWaiters = [];
  for (const resolve of waiters) resolve();
}

async function pumpSerialInput() {
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value?.length) {
        receiveBuffer.push(...result.value);
        notifyDataWaiters();
      }
    }
    if (!closing) readFailure = new Error('Serial connection closed during installation.');
  } catch (error) {
    if (!closing) readFailure = error;
  } finally {
    notifyDataWaiters();
  }
}

async function openSession(baudRate) {
  await closeSession();
  await port.open({
    baudRate,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
    bufferSize: 1024
  });
  receiveBuffer = [];
  readFailure = undefined;
  dataWaiters = [];
  reader = port.readable.getReader();
  readLoopPromise = pumpSerialInput();
}

async function closeSession() {
  if (reader) {
    closing = true;
    await reader.cancel().catch(() => {});
    await readLoopPromise?.catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // The lock may already be released after a physical disconnect.
    }
    reader = undefined;
    readLoopPromise = undefined;
    closing = false;
  }
  if (port?.readable || port?.writable) await port.close().catch(() => {});
  receiveBuffer = [];
  readFailure = undefined;
  notifyDataWaiters();
}

async function writeBytes(bytes) {
  if (!port?.writable) throw new Error('The selected serial port is not writable.');
  const writer = port.writable.getWriter();
  try {
    await writer.write(new Uint8Array(bytes));
  } finally {
    writer.releaseLock();
  }
}

async function waitForIncomingData(previousLength, timeoutMs) {
  // Web Serial is allowed to split one STK500 response into arbitrary chunks.
  // When part of a response is already buffered, wait for the buffer to grow;
  // treating any non-empty buffer as ready would spin and starve the read loop.
  if (receiveBuffer.length > previousLength || readFailure) return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = dataWaiters.indexOf(onData);
      if (index >= 0) dataWaiters.splice(index, 1);
      reject(new Error('Bootloader response timeout.'));
    }, timeoutMs);

    function onData() {
      clearTimeout(timeout);
      resolve();
    }

    dataWaiters.push(onData);
  });
}

async function readExact(count, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;

  while (receiveBuffer.length < count) {
    if (readFailure) throw new Error(`Serial read failed: ${readFailure.message ?? readFailure}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Bootloader response timeout (${receiveBuffer.length}/${count} bytes).`);
    }

    const previousLength = receiveBuffer.length;
    try {
      await waitForIncomingData(previousLength, remaining);
    } catch {
      throw new Error(`Bootloader response timeout (${receiveBuffer.length}/${count} bytes).`);
    }
  }

  return receiveBuffer.splice(0, count);
}

async function drainInput(durationMs = 60) {
  receiveBuffer = [];
  await sleep(durationMs);
  receiveBuffer = [];
}

async function stkCommand(payload, responsePayloadLength = 0, timeoutMs = 1500) {
  await writeBytes([...payload, CRC_EOP]);

  const start = await readExact(1, timeoutMs);
  if (start[0] !== STK_INSYNC) {
    throw new Error(`Expected STK_INSYNC (14), received ${hexByte(start[0])}.`);
  }

  const responsePayload = responsePayloadLength
    ? await readExact(responsePayloadLength, timeoutMs)
    : [];

  const end = await readExact(1, timeoutMs);
  if (end[0] !== STK_OK) {
    throw new Error(`Expected STK_OK (10), received ${hexByte(end[0])}.`);
  }

  return responsePayload;
}

async function synchronize(attempts, commandTimeoutMs = 550) {
  await drainInput();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await stkCommand([STK_GET_SYNC], 0, commandTimeoutMs);
      writeLog(`Bootloader synchronized on attempt ${attempt}.`);
      return;
    } catch (error) {
      await drainInput(40);
      if (attempt === attempts) throw error;
      await sleep(30);
    }
  }
}

async function readSignature() {
  const signature = await stkCommand([STK_READ_SIGN], 3);
  const text = signature.map(hexByte).join(' ');
  writeLog(`MCU signature: ${text}`);

  if (!signature.every((value, index) => value === EXPECTED_SIGNATURE[index])) {
    throw new WrongDeviceError(`Unsupported MCU signature ${text}; expected ATmega328P signature 1E 95 0F.`);
  }
}

async function enterBootloaderAt(baudRate, manualReset = false) {
  await openSession(baudRate);
  writeLog(`Trying Nano bootloader at ${baudRate} baud...`);

  if (manualReset) {
    setStatus(`Press and release RESET on the Nano now (${baudRate} baud).`);
    writeLog('Waiting for a manual reset...');
    await synchronize(18, 300);
  } else {
    await resetNano();
    await synchronize(10);
  }

  await readSignature();
  await stkCommand([STK_ENTER_PROGMODE]);
  writeLog('Bootloader entered programming mode.');
}

async function connectBootloader() {
  let lastError;

  for (const baudRate of BAUD_RATES) {
    try {
      await enterBootloaderAt(baudRate, false);
      return baudRate;
    } catch (error) {
      await closeSession();
      if (error instanceof WrongDeviceError) throw error;
      lastError = error;
      writeLog(`Automatic reset failed at ${baudRate} baud: ${error.message}`);
    }
  }

  for (const baudRate of BAUD_RATES) {
    try {
      await enterBootloaderAt(baudRate, true);
      return baudRate;
    } catch (error) {
      await closeSession();
      if (error instanceof WrongDeviceError) throw error;
      lastError = error;
      writeLog(`Manual reset failed at ${baudRate} baud: ${error.message}`);
    }
  }

  throw new Error(`Could not connect to the Arduino Nano bootloader. ${lastError?.message ?? ''}`);
}

async function loadAddress(byteAddress) {
  const wordAddress = byteAddress >> 1;
  await stkCommand([STK_LOAD_ADDRESS, wordAddress & 0xff, (wordAddress >> 8) & 0xff]);
}

async function programFlash(image) {
  setStatus('Installing firmware. Do not disconnect the Nano.');
  writeLog(`Programming ${image.length} application bytes...`);

  for (let address = 0; address < image.length; address += PAGE_SIZE) {
    const page = [...image.slice(address, address + PAGE_SIZE)];
    await loadAddress(address);
    await stkCommand([
      STK_PROG_PAGE,
      (page.length >> 8) & 0xff,
      page.length & 0xff,
      MEMORY_FLASH,
      ...page
    ], 0, 2000);

    setProgress(((address + page.length) / image.length) * 50);
  }
}

async function verifyFlash(image) {
  setStatus('Verifying installed firmware. Do not disconnect the Nano.');
  writeLog('Reading firmware back for byte-for-byte verification...');

  for (let address = 0; address < image.length; address += PAGE_SIZE) {
    const expected = image.slice(address, address + PAGE_SIZE);
    await loadAddress(address);
    const actual = await stkCommand([
      STK_READ_PAGE,
      (expected.length >> 8) & 0xff,
      expected.length & 0xff,
      MEMORY_FLASH
    ], expected.length, 2000);

    for (let index = 0; index < expected.length; index += 1) {
      if (actual[index] !== expected[index]) {
        const failedAddress = address + index;
        throw new Error(`Firmware verification failed at address 0x${failedAddress.toString(16).padStart(4, '0').toUpperCase()}.`);
      }
    }

    setProgress(50 + ((address + expected.length) / image.length) * 50);
  }
}

async function fetchFirmware() {
  setStatus('Downloading firmware...');
  const manifestResponse = await fetch('firmware/manifest.json', { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Could not download firmware manifest (${manifestResponse.status}).`);

  const manifest = await manifestResponse.json();
  if (
    manifest.board !== 'nanoatmega328' ||
    manifest.protocol !== EXPECTED_PROTOCOL ||
    manifest.file !== 'firmware.hex' ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version ?? '') ||
    !/^[0-9a-f]{64}$/i.test(manifest.sha256 ?? '') ||
    !Number.isInteger(manifest.size) ||
    manifest.size <= 0
  ) {
    throw new Error('Firmware manifest is invalid.');
  }

  const firmwareResponse = await fetch(`firmware/${manifest.file}`, { cache: 'no-store' });
  if (!firmwareResponse.ok) throw new Error(`Could not download firmware (${firmwareResponse.status}).`);

  const firmwareBytes = await firmwareResponse.arrayBuffer();
  if (firmwareBytes.byteLength !== manifest.size) {
    throw new Error('Downloaded firmware size does not match the manifest.');
  }

  const digest = await sha256Hex(firmwareBytes);
  if (digest !== manifest.sha256.toLowerCase()) {
    throw new Error('Downloaded firmware failed the integrity check.');
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(firmwareBytes);
  const parsed = parseIntelHex(text, { maximumSize: MAX_APPLICATION_SIZE });
  writeLog(`Firmware ${manifest.version} loaded and integrity-checked (${parsed.usedLength} used bytes).`);
  return { ...parsed, version: manifest.version };
}

window.addEventListener('beforeunload', event => {
  if (!installing) return;
  event.preventDefault();
  event.returnValue = '';
});

openProgrammerLink.addEventListener('click', event => {
  if (installing) event.preventDefault();
});

installButton.addEventListener('click', async () => {
  setInstalling(true);
  logElement.textContent = '';
  setProgress(0);
  setStatus('Preparing installation...');

  let stage = 'preparing';

  try {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial is not supported. Use Chrome or Edge on a desktop computer.');
    }

    const firmware = await fetchFirmware();
    port = await navigator.serial.requestPort();
    const info = port.getInfo?.() ?? {};
    writeLog(`Selected USB VID=${info.usbVendorId ?? 'n/a'} PID=${info.usbProductId ?? 'n/a'}.`);

    const baudRate = await connectBootloader();
    writeLog(`ATmega328P bootloader connected at ${baudRate} baud.`);

    stage = 'programming';
    await programFlash(firmware.image);
    stage = 'verifying';
    await verifyFlash(firmware.image);
    await stkCommand([STK_LEAVE_PROGMODE], 0, 1500);

    stage = 'complete';
    setProgress(100);
    setStatus(`Firmware ${firmware.version} installed and verified successfully.`, 'success');
    writeLog('Installation and flash verification completed successfully.');
  } catch (error) {
    const details = error.message ?? String(error);
    const prefix = stage === 'verifying'
      ? 'Firmware was written but could not be verified. Do not use the programmer until installation finishes successfully. '
      : '';
    setStatus(`${prefix}${details}`, 'error');
    writeLog(`ERROR: ${details}`);
  } finally {
    await closeSession();
    port = undefined;
    setInstalling(false);
  }
});
