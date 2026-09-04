# iButton Programmer

Web-based iButton reader/programmer using Web Serial and an Arduino Nano ATmega328P.

**Web programmer:** https://misiu.github.io/iButton/

**Firmware installer:** https://misiu.github.io/iButton/install.html

## Hardware

The supported programmer is a classic **5 V Arduino Nano with ATmega328P**. USB-C Nano boards are suitable when they retain the ATmega328P/Nano electrical design and a compatible serial bootloader.

| Function | Arduino Nano | Connection |
| --- | --- | --- |
| iButton 1-Wire DATA | D2 | iButton center DATA contact |
| DATA pull-up | 5V | 2.2 kOhm resistor to D2 |
| Probe LED/status | D4 | Optional LED/status output; ~3.3 kOhm series resistor |
| Ground | GND | iButton outer contact |

```text
              2.2 kOhm
Nano 5V ------/\/\/\------+
                            |
Nano D2 --------------------+---- iButton center DATA

Nano GND ------------------------ iButton outer shell
```

Do not connect the iButton DATA contact directly to 5 V. The 2.2 kOhm resistor is the 1-Wire pull-up between 5 V and D2.

## Product protocol

Serial settings: **9600 baud, 8 data bits, no parity, 1 stop bit**.

The programmer uses a line-oriented text protocol. Each command ends with a newline.

### Identify programmer

```text
INFO
```

Example response:

```text
OK INFO PRODUCT=IBUTTON_PROGRAMMER FW=0.3.0 PROTO=3 BOARD=NANO328P
```

The web application requires a supported product and protocol version before enabling Read/Write.

### Read

```text
READ
```

The programmer waits up to 5 seconds for an iButton. Example response:

```text
OK READ 12 34 56 78 9A BC
```

### Write

```text
WRITE 12 34 56 78 9A BC
```

The programmer validates the requested serial number, detects a supported writable tag, programs it using the appropriate implementation, and verifies the resulting code before reporting success.

Example response:

```text
OK WRITE TYPE=RW1990V1
```

A successful response means that programming and verification both completed successfully.

### Detect

```text
DETECT
```

Example response:

```text
OK DETECT TYPE=RW1990V1
```

### Errors

Errors use a stable machine-readable format, for example:

```text
ERROR NO_BUTTON
ERROR INVALID_SERIAL
ERROR NOT_WRITABLE_OR_UNSUPPORTED
ERROR BUTTON_REMOVED
ERROR VERIFY_FAILED
ERROR TYPE_CHANGED
ERROR UNKNOWN_COMMAND
```

## Web app

Open https://misiu.github.io/iButton/ in a Chromium-based browser with Web Serial support.

The web app identifies the connected programmer before exposing the programming interface. It communicates only with the current product protocol; legacy binary commands are not supported.

- **Read** reads and displays the six-byte serial number.
- **Write** programs the requested serial number and reports success only after verification.
- **Protocol log** shows product-level serial communication and diagnostic errors.

## Firmware installation

Open https://misiu.github.io/iButton/install.html and connect the Arduino Nano by USB. The browser installer downloads the Nano HEX produced by CI and flashes it through the Nano STK500v1 serial bootloader.

The installer tries the two common ATmega328P Nano bootloader speeds: **115200 baud** and **57600 baud**.

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
