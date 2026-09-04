# iButton Programmer

Web-based iButton reader/programmer using Web Serial and an Arduino Nano ATmega328P.

**Web programmer:** https://misiu.github.io/iButton/

**Firmware installer:** https://misiu.github.io/iButton/install.html

## Hardware

The supported programmer is a classic **5 V Arduino Nano with ATmega328P**. USB-C Nano boards are suitable when they retain the ATmega328P/Nano electrical design and a compatible serial bootloader.

The wiring reproduces the known-working legacy programmer:

| Function | Arduino Nano | Connection |
| --- | --- | --- |
| iButton 1-Wire DATA | D2 | iButton center DATA contact |
| DATA pull-up | 5V | 2.2 kOhm resistor to D2 |
| Probe LED/status | D4 | Optional LED/status output; legacy probe used ~3.3 kOhm series resistor |
| Ground | GND | iButton outer contact |

```text
              2.2 kOhm
Nano 5V ------/\/\/\------+ 
                            |
Nano D2 --------------------+---- iButton center DATA

Nano GND ------------------------ iButton outer shell
```

Do not connect the iButton DATA contact directly to 5 V. The 2.2 kOhm resistor is the 1-Wire pull-up between 5 V and D2.

## Serial protocol

Serial settings: **9600 baud, 8 data bits, no parity, 1 stop bit**.

Commands are 11 raw binary bytes:

- read: `01 01 00 00 00 00 00 00 00 00 02`
- write: `00 01 <8-byte ROM> <checksum>`

The final command byte is the 8-bit additive checksum of the preceding ten bytes.

The ROM contains family byte `0x01`, six serial bytes in Dallas ROM order, and Dallas/Maxim CRC-8. The browser presents only the six serial bytes in human-readable order and builds the complete ROM before sending a write command.

## Firmware behavior

The firmware intentionally reproduces the behavior recovered from the known-working legacy Arduino Nano firmware. It does **not** contain ESP32/XIAO-specific code, alternative RW1990 write algorithms, automatic fallback programming methods, or experimental write-mode commands.

### Read

1. Turn D4 status output on.
2. Search for an iButton on D2.
3. Retry up to 3 times with approximately 1 second between failed searches.
4. On success, print all 8 ROM bytes as uppercase hexadecimal separated by spaces.
5. On failure, return `ERROR: Timeout`.
6. Turn D4 off.

The recovered legacy firmware did not reject a ROM based on Dallas CRC during this operation, so the replacement firmware does not add that behavior.

### Write

The write path is intentionally limited to the sequence recovered from the working legacy Nano:

1. Turn D4 status output on.
2. Search for the iButton up to 5 times, with approximately 1 second between failed searches.
3. Send the recovered preamble: `0xCC`, reset, `0x33`, `0xCC`, reset, `0xD5`.
4. Program the 8 ROM bytes from the host command, least-significant bit first.
5. For a `1` bit: drive D2 LOW as output for approximately 60 us, release D2 to input, enable the AVR input pull-up, then wait approximately 10 ms.
6. For a `0` bit: drive D2 LOW as output, release it immediately to input, enable the AVR input pull-up, then wait approximately 10 ms.
7. Reset the 1-Wire bus and return `OK`.
8. Turn D4 off.

No D1/1D fallback algorithms and no additional write attempts are performed. The firmware mirrors the known-working legacy programmer rather than experimenting with other RW1990 variants.

## Web app

Open https://misiu.github.io/iButton/ in a Chromium-based browser with Web Serial support.

- **Read** reads the ROM and displays the six-byte serial number.
- **Write** builds the family/serial/CRC ROM and sends the legacy write command.
- **Protocol log** shows raw serial traffic and can be copied to the clipboard.

## Firmware installation

Open https://misiu.github.io/iButton/install.html and connect the Arduino Nano by USB. The browser installer downloads the Nano HEX produced by CI and flashes it through the Nano STK500v1 serial bootloader.

The installer tries the two common ATmega328P Nano bootloader speeds: **115200 baud** and **57600 baud**. This covers the common current and old Nano bootloader variants without changing the application firmware.

## Build

Firmware is built with PlatformIO for `nanoatmega328`:

```bash
cd firmware
pio run
```

The GitHub Pages workflow builds the same firmware and publishes `firmware.hex` for the browser installer.

## Repository structure

- `firmware/` — Arduino Nano ATmega328P firmware
- `web/index.html` — Read/Write interface
- `web/install.html` — Nano browser installer
- `web/nano-installer.js` — STK500v1 Web Serial flasher
- `.github/workflows/firmware.yml` — Nano firmware CI build
- `.github/workflows/pages.yml` — builds Nano firmware and deploys the web application and installer
