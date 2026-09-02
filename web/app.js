const BAUD_RATE = 9600;
const RESPONSE_TIMEOUT_MS = 6500;

const connectButton = document.querySelector('#connect');
const readButton = document.querySelector('#read');
const writeButton = document.querySelector('#write');
const serialInput = document.querySelector('#serial');
const programmer = document.querySelector('#programmer');
const status = document.querySelector('#status');
const message = document.querySelector('#message');

let port;
let reader;
let receiveBuffer = '';

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
  if (hex.length !== 12) throw new Error('Numer seryjny musi zawierać dokładnie 6 bajtów.');
  return hex.match(/../g).join(' ');
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

function parseLegacyReadResponse(line) {
  if (line.includes('ERROR')) {
    const error = line.length > 6 ? line.substring(6) : line;
    throw new Error(error || 'Błąd odczytu iButton.');
  }

  const tokens = line.trim().split(/\s+/);
  if (tokens.length !== 8 || !tokens.every(x => /^[0-9a-fA-F]{2}$/.test(x))) {
    throw new Error(`Nieprawidłowa odpowiedź urządzenia: ${line}`);
  }

  // Legacy WinForms reversed all 8 ROM bytes, then removed CRC and family byte.
  return tokens.slice(1, 7).reverse().join(' ').toUpperCase();
}

async function connect() {
  if (!('serial' in navigator)) {
    throw new Error('Ta przeglądarka nie obsługuje Web Serial. Użyj Chrome/Chromium na Androidzie lub komputerze.');
  }

  port = await navigator.serial.requestPort();
  await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
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
  setConnected(false);
}

function setConnected(connected) {
  programmer.hidden = !connected;
  status.textContent = connected ? 'Połączony' : 'Rozłączony';
  status.className = `status ${connected ? 'connected' : 'disconnected'}`;
  connectButton.textContent = connected ? 'Rozłącz urządzenie' : 'Połącz urządzenie';
}

async function writeBytes(bytes) {
  if (!port?.writable) throw new Error('Programator nie jest połączony.');
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

async function readLine(timeoutMs = RESPONSE_TIMEOUT_MS) {
  if (!port?.readable) throw new Error('Programator nie jest połączony.');
  const decoder = new TextDecoder();
  reader = port.readable.getReader();
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Przekroczono czas oczekiwania na iButton.')), remaining))
      ]);
      if (result.done) throw new Error('Połączenie z programatorem zostało przerwane.');
      receiveBuffer += decoder.decode(result.value, { stream: true });
      const newline = receiveBuffer.search(/[\r\n]/);
      if (newline >= 0) {
        const line = receiveBuffer.slice(0, newline);
        receiveBuffer = receiveBuffer.slice(newline).replace(/^[\r\n]+/, '');
        return line.trim();
      }
    }
    throw new Error('Przekroczono czas oczekiwania na odpowiedź.');
  } finally {
    reader.releaseLock();
    reader = undefined;
  }
}

async function command(bytes) {
  receiveBuffer = '';
  await writeBytes(bytes);
  return await readLine();
}

async function runBusy(fn) {
  readButton.disabled = true;
  writeButton.disabled = true;
  message.className = 'message';
  message.textContent = '';
  try {
    await fn();
  } catch (error) {
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
  message.textContent = 'Przyłóż iButton do czytnika…';
  const response = await command(buildReadCommand());
  serialInput.value = parseLegacyReadResponse(response);
  message.className = 'message success';
  message.textContent = 'Numer odczytany.';
}));

writeButton.addEventListener('click', () => runBusy(async () => {
  const normalized = normalizeSerial(serialInput.value);
  serialInput.value = normalized;
  message.textContent = 'Przyłóż programowalny iButton do czytnika…';
  const response = await command(buildWriteCommand(normalized));
  if (response !== 'OK') throw new Error(response || 'Nie udało się zapisać numeru.');
  message.className = 'message success';
  message.textContent = 'Numer seryjny zapisany.';
}));

serialInput.addEventListener('blur', () => {
  if (!serialInput.value.trim()) return;
  try { serialInput.value = normalizeSerial(serialInput.value); } catch { }
});

navigator.serial?.addEventListener('disconnect', event => {
  if (event.target === port) {
    port = undefined;
    setConnected(false);
    message.className = 'message error';
    message.textContent = 'Programator został odłączony.';
  }
});
