# iButton Programmer

Web Serial based iButton programmer for ESP32-S3.

## Project status

Initial migration from the legacy WinForms application.

The legacy protocol used two binary commands over 9600 8N1 serial:

- read: `01 01 00 00 00 00 00 00 00 02`
- write: `00 01 <8-byte ROM> <checksum>`

The final command byte is an 8-bit additive checksum of all previous command bytes.

The iButton ROM is 8 bytes: family byte `0x01`, six serial-number bytes and Dallas/Maxim CRC-8 as byte 8. The serial-number field shown in the UI contains only the six serial-number bytes, in human-readable order.

## Structure

- `firmware/` — ESP32-S3 firmware
- `web/` — static Web Serial programmer UI, suitable for GitHub Pages
- `.github/workflows/pages.yml` — GitHub Pages deployment

## Target hardware

Seeed Studio XIAO ESP32-S3 is the initial target.

The 1-Wire data GPIO is configurable in `firmware/platformio.ini` via `IBUTTON_PIN`.

## Web app

The web app uses the browser Web Serial API. Chrome/Chromium on Android and desktop are the intended platforms.

The UI implements the two required operations:

- Read
- Write

The web side preserves the legacy wire protocol so it can first be tested against the existing Arduino programmer before switching to the ESP32-S3 firmware.

## Local web development

The site is deliberately plain HTML/CSS/JavaScript. No build step is required.

Serve `web/` over HTTPS or localhost, for example:

```bash
python -m http.server 8000 -d web
```

Web Serial requires a secure context (HTTPS, or localhost for development).

## Firmware

The firmware is built with PlatformIO and Arduino framework.

```bash
cd firmware
pio run
```

The default serial rate is 9600 baud to remain compatible with the legacy application/protocol.
