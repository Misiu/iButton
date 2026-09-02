# iButton Programmer

Web-based iButton reader/programmer using Web Serial, with new firmware targeting Seeed Studio XIAO ESP32-C3.

**Programmer:** https://misiu.github.io/ibutton/

## Compatibility

The web application preserves the serial protocol used by the legacy Arduino Nano programmer, so the same page can be used to test the existing Mini-USB device before migrating the hardware to XIAO ESP32-C3.

Serial: 9600 baud, 8 data bits, no parity, 1 stop bit.

Legacy binary commands are 11 bytes:

- read: `01 01 00 00 00 00 00 00 00 00 02`
- write: `00 01 <8-byte ROM> <checksum>`

The final command byte is an 8-bit additive checksum of all previous command bytes.

The iButton ROM is 8 bytes: family byte `0x01`, six serial-number bytes and Dallas/Maxim CRC-8 as byte 8. The serial-number field shown in the UI contains only the six serial-number bytes in human-readable order.

## Structure

- `firmware/` — XIAO ESP32-C3 firmware
- `web/` — static Web Serial programmer UI deployed to GitHub Pages
- `.github/workflows/pages.yml` — GitHub Pages deployment
- `.github/workflows/firmware.yml` — firmware CI build

## Target hardware

Seeed Studio XIAO ESP32-C3.

The 1-Wire data GPIO is configurable in `firmware/platformio.ini` via `IBUTTON_PIN`. It is currently set to GPIO2; this remains provisional until the final wiring is selected.

The RW1990/TM1990 write sequence in the new ESP32-C3 firmware is also provisional until verified against the original Arduino firmware or tested with the actual writable tokens. The web application's legacy serial protocol does not depend on this and can be tested with the existing Arduino Nano programmer now.

## Web app

Open https://misiu.github.io/ibutton/ in a Web Serial capable browser, connect the programmer and use:

- **Odczytaj** — reads the iButton ROM and displays its six-byte serial number
- **Zapisz** — builds the complete family/serial/CRC ROM and sends it to the programmer

Web Serial requires HTTPS (GitHub Pages provides this) or localhost for development.

## Firmware

The firmware is built with PlatformIO and Arduino framework:

```bash
cd firmware
pio run
```
