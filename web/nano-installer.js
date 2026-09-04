const installButton = document.querySelector('#install');
const log = document.querySelector('#install-log');

const STK_OK = 0x10;
const STK_INSYNC = 0x14;
const CRC_EOP = 0x20;
const PAGE_SIZE = 128;

function writeLog(text) {
  log.textContent += `${text}\n`;
  log.scrollTop = log.scrollHeight;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readExact(reader, count, timeout = 1200) {
  const bytes = [];
  const deadline = Date.now() + timeout;
  while (bytes.length < count) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Bootloader response timeout.');
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Bootloader response timeout.')), remaining))
    ]);
    if (result.done) throw new Error('Serial connection closed.');
    bytes.push(...result.value);
  }
  return bytes.slice(0, count);
}

async function command(port, payload, responseLength = 2) {
  const writer = port.writable.getWriter();
  try { await writer.write(new Uint8Array([...payload, CRC_EOP])); }
  finally { writer.releaseLock(); }
  const reader = port.readable.getReader();
  try {
    const response = await readExact(reader, responseLength);
    if (response[0] !== STK_INSYNC || response[response.length - 1] !== STK_OK) {
      throw new Error(`Unexpected bootloader response: ${response.map(x => x.toString(16).padStart(2, '0')).join(' ')}`);
    }
    return response;
  } finally { reader.releaseLock(); }
}

async function resetNano(port) {
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  await sleep(100);
  await port.setSignals({ dataTerminalReady: true, requestToSend: false });
  await sleep(350);
}

async function sync(port) {
  for (let i = 0; i < 5; i++) {
    try { await command(port, [0x30]); return; }
    catch { await sleep(120); }
  }
  throw new Error('Could not synchronize with the Nano bootloader.');
}

function parseHex(text) {
  const flash = new Map();
  let upper = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith(':')) throw new Error('Invalid Intel HEX file.');
    const data = [];
    for (let i = 1; i < line.length; i += 2) data.push(Number.parseInt(line.slice(i, i + 2), 16));
    const length = data[0];
    const address = (data[1] << 8) | data[2];
    const type = data[3];
    const checksum = data.reduce((sum, b) => (sum + b) & 0xff, 0);
    if (checksum !== 0) throw new Error('Invalid Intel HEX checksum.');
    if (type === 0x00) {
      const base = upper + address;
      for (let i = 0; i < length; i++) flash.set(base + i, data[4 + i]);
    } else if (type === 0x04) {
      upper = (((data[4] << 8) | data[5]) << 16) >>> 0;
    } else if (type === 0x01) break;
  }
  if (!flash.size) throw new Error('Firmware HEX contains no data.');
  const max = Math.max(...flash.keys());
  const image = new Uint8Array(max + 1).fill(0xff);
  for (const [address, value] of flash) image[address] = value;
  return image;
}

async function flashAtBaud(port, baudRate, image) {
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  try {
    await resetNano(port);
    await sync(port);
    writeLog(`Bootloader synchronized at ${baudRate} baud.`);

    for (let address = 0; address < image.length; address += PAGE_SIZE) {
      const page = image.slice(address, Math.min(address + PAGE_SIZE, image.length));
      const wordAddress = address >> 1;
      await command(port, [0x55, wordAddress & 0xff, (wordAddress >> 8) & 0xff]);
      await command(port, [0x64, (page.length >> 8) & 0xff, page.length & 0xff, 0x46, ...page]);
      const percent = Math.round((Math.min(address + page.length, image.length) / image.length) * 100);
      writeLog(`Writing firmware... ${percent}%`);
    }

    await command(port, [0x51]);
  } finally {
    await port.close().catch(() => {});
  }
}

installButton.addEventListener('click', async () => {
  installButton.disabled = true;
  log.textContent = '';
  let port;
  try {
    if (!('serial' in navigator)) throw new Error('Web Serial is not supported by this browser.');
    writeLog('Downloading firmware...');
    const response = await fetch('firmware/firmware.hex', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not download firmware (${response.status}).`);
    const image = parseHex(await response.text());
    writeLog(`Firmware loaded: ${image.length} bytes.`);
    port = await navigator.serial.requestPort();

    let lastError;
    for (const baud of [115200, 57600]) {
      try {
        writeLog(`Trying Nano bootloader at ${baud} baud...`);
        await flashAtBaud(port, baud, image);
        writeLog('Firmware installed successfully.');
        return;
      } catch (error) {
        lastError = error;
        writeLog(`No compatible bootloader at ${baud} baud.`);
        if (port.readable || port.writable) await port.close().catch(() => {});
        await sleep(250);
      }
    }
    throw lastError ?? new Error('Firmware installation failed.');
  } catch (error) {
    writeLog(`ERROR: ${error.message ?? String(error)}`);
  } finally {
    if (port && (port.readable || port.writable)) await port.close().catch(() => {});
    installButton.disabled = false;
  }
});
