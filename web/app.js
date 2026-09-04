import {
  MINIMUM_FIRMWARE_VERSION,
  SUPPORTED_BOARD,
  SUPPORTED_PROTOCOL_VERSION,
  compareVersions,
  friendlyError,
  isProtocolResponse,
  normalizeSerial,
  parseDetectResponse,
  parseInfoResponse,
  parseReadResponse,
  parseWriteResponse
} from './protocol.js';

const BAUD_RATE = 9600;
const BOOT_SETTLE_MS = 1000;
const INFO_TIMEOUT_MS = 1500;
const READ_TIMEOUT_MS = 6500;
const WRITE_TIMEOUT_MS = 10000;
const DETECT_TIMEOUT_MS = 6500;

const connectButton = document.querySelector('#connect');
const readButton = document.querySelector('#read');
const writeButton = document.querySelector('#write');
const detectButton = document.querySelector('#detect');
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
let readLoopPromise;
let receiveBuffer = '';
let pendingRequest;
let deviceInfo;
let operation = null;
let connecting = false;
let closingPort = false;

const defaultLabels = {
  read: 'Read',
  write: 'Write',
  detect: 'Detect type'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logProtocol(direction, value) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  protocolLog.textContent += `[${time}] ${direction} ${value || '<empty>'}\n`;
  protocolLog.scrollTop = protocolLog.scrollHeight;
}

function setMessage(text = '', type = '') {
  message.textContent = text;
  message.className = `message${type ? ` ${type}` : ''}`;
}

function getSerial() {
  return normalizeSerial(serialFields.map(field => field.value).join(''));
}

function isSerialComplete() {
  return serialFields.every(field => /^[0-9A-F]{2}$/i.test(field.value));
}

function setSerial(value) {
  const bytes = normalizeSerial(value).split(' ');
  serialFields.forEach((field, index) => {
    field.value = bytes[index];
  });
  updateControls();
}

function distributeHex(text, requestedStartIndex = 0) {
  const hex = String(text).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!hex) return;

  const startIndex = hex.length >= 12 ? 0 : requestedStartIndex;
  let position = 0;
  for (let index = startIndex; index < serialFields.length && position < hex.length; index += 1) {
    serialFields[index].value = hex.slice(position, position + 2);
    position += 2;
  }

  const used = Math.ceil(Math.min(hex.length, (serialFields.length - startIndex) * 2) / 2);
  const focusIndex = Math.min(startIndex + used, serialFields.length - 1);
  serialFields[focusIndex].focus();
  serialFields[focusIndex].select();
  setMessage();
  updateControls();
}

function isConnected() {
  return Boolean(port && deviceInfo);
}

function updateControls() {
  const connected = isConnected();
  const busy = Boolean(operation);

  connectButton.disabled = connecting || busy;
  readButton.disabled = !connected || busy;
  detectButton.disabled = !connected || busy;
  writeButton.disabled = !connected || busy || !isSerialComplete();
  serialFields.forEach(field => {
    field.disabled = !connected || busy;
  });

  readButton.textContent = operation === 'read' ? 'Reading…' : defaultLabels.read;
  writeButton.textContent = operation === 'write' ? 'Writing…' : defaultLabels.write;
  detectButton.textContent = operation === 'detect' ? 'Detecting…' : defaultLabels.detect;

  const activeButton = { read: readButton, write: writeButton, detect: detectButton }[operation];
  for (const button of [readButton, writeButton, detectButton]) {
    button.setAttribute('aria-busy', button === activeButton ? 'true' : 'false');
  }
}

function setConnectionState(state) {
  const connected = state === 'connected';
  programmer.hidden = !connected;
  status.textContent = state === 'connecting' ? 'Connecting' : connected ? 'Connected' : 'Disconnected';
  status.className = `status ${state}`;
  connectButton.textContent = state === 'connecting'
    ? 'Connecting…'
    : connected
      ? 'Disconnect device'
      : 'Connect device';
  updateControls();
}

function userFacingError(error) {
  const raw = error?.message ?? String(error);
  if (/^[A-Z][A-Z0-9_]*(?:\s.*)?$/.test(raw)) return friendlyError(raw);
  return raw;
}

function settlePendingRequest(error, response) {
  if (!pendingRequest) return;
  const request = pendingRequest;
  pendingRequest = undefined;
  clearTimeout(request.timer);
  if (error) request.reject(error);
  else request.resolve(response);
}

function processReceivedLines() {
  while (true) {
    const newline = receiveBuffer.search(/[\r\n]/);
    if (newline < 0) return;

    const line = receiveBuffer.slice(0, newline).trim();
    receiveBuffer = receiveBuffer.slice(newline).replace(/^[\r\n]+/, '');
    if (!line) continue;

    logProtocol('RX  ', line);
    if (!isProtocolResponse(line)) {
      logProtocol('SKIP', 'non-protocol startup data');
      continue;
    }

    if (!pendingRequest) {
      logProtocol('SKIP', 'unsolicited protocol response');
      continue;
    }

    if (line.startsWith('ERROR ') || pendingRequest.matcher(line)) {
      settlePendingRequest(null, line);
    } else {
      logProtocol('SKIP', `unexpected response while waiting for ${pendingRequest.name}`);
    }
  }
}

async function startReadLoop() {
  if (!port?.readable) throw new Error('The programmer did not expose a readable serial stream.');

  const decoder = new TextDecoder();
  const activeReader = port.readable.getReader();
  reader = activeReader;

  readLoopPromise = (async () => {
    try {
      while (true) {
        const result = await activeReader.read();
        if (result.done) break;
        receiveBuffer += decoder.decode(result.value, { stream: true });
        processReceivedLines();
      }
    } catch (error) {
      if (!closingPort) {
        const connectionError = new Error(
          operation === 'write'
            ? 'The programmer disconnected during writing. Read the iButton before attempting another write.'
            : 'The serial connection was interrupted.'
        );
        settlePendingRequest(connectionError);
        deviceInfo = undefined;
        setConnectionState('disconnected');
        setMessage(connectionError.message, 'error');
        logProtocol('ERR ', error?.message ?? String(error));
      }
    } finally {
      try {
        activeReader.releaseLock();
      } catch {
        // The lock may already be released after a physical disconnect.
      }
      if (reader === activeReader) reader = undefined;
    }
  })();
}

async function writeText(text) {
  if (!port?.writable) throw new Error('The programmer is not connected.');
  logProtocol('TX  ', text);
  const writer = port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${text}\n`));
  } finally {
    writer.releaseLock();
  }
}

async function command(text, timeoutMs, matcher, name) {
  if (pendingRequest) throw new Error('Another programmer command is still pending.');

  // Discard an incomplete startup line before beginning a new request. Complete
  // responses are already consumed by the persistent read loop.
  receiveBuffer = '';

  const responsePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendingRequest) return;
      pendingRequest = undefined;
      const error = new Error(`Timed out while waiting for ${name}. Reconnect the programmer before trying again.`);
      error.requiresReconnect = true;
      reject(error);
    }, timeoutMs);
    pendingRequest = { resolve, reject, timer, matcher, name };
  });

  try {
    await writeText(text);
  } catch (error) {
    settlePendingRequest(error);
  }

  return responsePromise;
}

async function identifyProgrammer() {
  const deadline = Date.now() + INFO_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await command(
        'INFO',
        Math.min(remaining, 650),
        line => line.startsWith('OK INFO '),
        'programmer identification'
      );
      const info = parseInfoResponse(response);
      if (info.protocol !== SUPPORTED_PROTOCOL_VERSION) {
        throw new Error(`Unsupported programmer protocol version: ${info.protocol}.`);
      }
      if (info.board !== SUPPORTED_BOARD) {
        throw new Error(`Unsupported programmer board: ${info.board}.`);
      }
      if (compareVersions(info.firmware, MINIMUM_FIRMWARE_VERSION) < 0) {
        throw new Error(`Firmware ${MINIMUM_FIRMWARE_VERSION} or newer is required. Open the firmware installer and update the programmer.`);
      }
      deviceInfo = info;
      logProtocol('INFO', `programmer firmware=${info.firmware} protocol=${info.protocol}`);
      return;
    } catch (error) {
      lastError = error;
      if (!error.requiresReconnect && Date.now() < deadline) await sleep(80);
    }
  }

  throw lastError ?? new Error('The connected device is not a supported iButton Programmer.');
}

async function connect() {
  if (!('serial' in navigator)) {
    throw new Error('This browser does not support Web Serial. Use Chrome or Edge on a desktop computer.');
  }

  connecting = true;
  setConnectionState('connecting');

  try {
    if (port) await disconnect({ log: false });
    port = await navigator.serial.requestPort();
    await port.open({
      baudRate: BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 1024
    });

    receiveBuffer = '';
    const info = port.getInfo?.() ?? {};
    logProtocol('INFO', `connected baud=${BAUD_RATE} usbVendorId=${info.usbVendorId ?? 'n/a'} usbProductId=${info.usbProductId ?? 'n/a'}`);
    await startReadLoop();

    // Opening a Nano serial port can reset it. Let the bootloader hand control
    // to firmware before sending INFO.
    await sleep(BOOT_SETTLE_MS);
    await identifyProgrammer();
    setConnectionState('connected');
  } finally {
    connecting = false;
    updateControls();
  }
}

async function disconnect({ log = true } = {}) {
  closingPort = true;
  settlePendingRequest(new Error('The programmer was disconnected.'));

  if (reader) await reader.cancel().catch(() => {});
  if (readLoopPromise) await readLoopPromise.catch(() => {});
  if (port?.readable || port?.writable) await port.close().catch(() => {});

  reader = undefined;
  readLoopPromise = undefined;
  port = undefined;
  deviceInfo = undefined;
  receiveBuffer = '';
  operation = null;
  connecting = false;
  closingPort = false;
  if (log) logProtocol('INFO', 'disconnected');
  setConnectionState('disconnected');
}

async function runOperation(name, pendingMessage, action) {
  if (operation) return;
  operation = name;
  setMessage(pendingMessage);
  updateControls();

  try {
    await action();
  } catch (error) {
    const raw = error?.message ?? String(error);
    logProtocol('ERR ', raw);
    if (error?.requiresReconnect && port) await disconnect({ log: false }).catch(() => {});
    setMessage(userFacingError(error), 'error');
  } finally {
    operation = null;
    updateControls();
  }
}

serialFields.forEach((field, index) => {
  field.addEventListener('input', () => {
    const hex = field.value.toUpperCase().replace(/[^0-9A-F]/g, '');
    field.value = hex.slice(0, 2);
    if (field.value.length === 2 && index < serialFields.length - 1) {
      serialFields[index + 1].focus();
      serialFields[index + 1].select();
    }
    setMessage();
    updateControls();
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

clearLogButton.addEventListener('click', () => {
  protocolLog.textContent = '';
});

copyLogButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(protocolLog.textContent);
    const original = copyLogButton.textContent;
    copyLogButton.textContent = 'Copied';
    setTimeout(() => {
      copyLogButton.textContent = original;
    }, 1200);
  } catch {
    setMessage('Could not copy the debug log.', 'error');
  }
});

connectButton.addEventListener('click', async () => {
  if (operation || connecting) return;

  try {
    if (isConnected()) await disconnect();
    else await connect();
  } catch (error) {
    const raw = error?.message ?? String(error);
    logProtocol('ERR ', raw);
    if (port) await disconnect({ log: false }).catch(() => {});
    else setConnectionState('disconnected');
    setMessage(userFacingError(error), 'error');
  }
});

readButton.addEventListener('click', () => runOperation(
  'read',
  'Touch and hold an iButton on the reader.',
  async () => {
    const response = await command(
      'READ',
      READ_TIMEOUT_MS,
      line => line.startsWith('OK READ '),
      'the read result'
    );
    setSerial(parseReadResponse(response));
    setMessage('Serial number read successfully. You can remove the iButton.', 'success');
  }
));

writeButton.addEventListener('click', () => runOperation(
  'write',
  'Keep the writable iButton firmly in place until programming and verification finish.',
  async () => {
    const serial = getSerial();
    setSerial(serial);
    setMessage(`Writing ${serial}. Keep the iButton firmly in place until verification finishes.`);

    const response = await command(
      `WRITE ${serial}`,
      WRITE_TIMEOUT_MS,
      line => line.startsWith('OK WRITE '),
      'the write result'
    );
    const result = parseWriteResponse(response);

    setMessage(
      result.unchanged
        ? 'The iButton already has this serial number. No write was performed.'
        : 'Written and verified. You can remove the iButton.',
      'success'
    );
  }
));

detectButton.addEventListener('click', () => runOperation(
  'detect',
  'Touch and hold a writable iButton while its type is checked.',
  async () => {
    const response = await command(
      'DETECT',
      DETECT_TIMEOUT_MS,
      line => line.startsWith('OK DETECT '),
      'the detection result'
    );
    const type = parseDetectResponse(response);
    setMessage(`Detected writable iButton type: ${type}. The serial number was not changed.`, 'success');
  }
));

navigator.serial?.addEventListener('disconnect', event => {
  const disconnectedPort = event.port ?? event.target;
  if (disconnectedPort !== port) return;

  const error = new Error(
    operation === 'write'
      ? 'The programmer disconnected during writing. Read the iButton before attempting another write.'
      : 'The programmer was disconnected.'
  );
  settlePendingRequest(error);
  port = undefined;
  deviceInfo = undefined;
  receiveBuffer = '';
  setConnectionState('disconnected');
  logProtocol('INFO', 'device disconnected');
  setMessage(error.message, 'error');
});

window.addEventListener('beforeunload', event => {
  if (!operation) return;
  event.preventDefault();
  event.returnValue = '';
});

setConnectionState('disconnected');
