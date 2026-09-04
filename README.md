# iButton Programmer

A browser-based reader and programmer for supported writable iButtons, built around a classic 5 V Arduino Nano ATmega328P and Web Serial.

**Web programmer:** https://misiu.github.io/iButton/

**Firmware installer:** https://misiu.github.io/iButton/install.html

**Current firmware:** `0.4.0`  
**Protocol:** `3`

## Hardware

Use a classic **5 V, 16 MHz Arduino Nano with ATmega328P**. A standard-size USB-C Nano clone is suitable when it retains the classic Nano pinout, 5 V logic, and a compatible serial bootloader.

| Function | Arduino Nano | Connection |
| --- | --- | --- |
| iButton 1-Wire DATA | D2 | Center DATA contact |
| DATA pull-up | 5V | 2.2 kOhm resistor to D2 |
| Status LED | D4 | Optional; use an appropriate series resistor |
| Ground | GND | Outer iButton contact |

```text
              2.2 kOhm
Nano 5V ------/\/\/\------+
                            |
Nano D2 --------------------+---- iButton center DATA contact

Nano GND ------------------------ iButton outer contact
```

Do not connect the iButton DATA contact directly to 5 V. The 2.2 kOhm resistor must be between 5 V and D2.

## Supported iButtons

Firmware 0.4.0 writes only the following detected families:

- RW1990 / RW1990.1-compatible tags (`RW1990V1`)
- RW1990.2-compatible tags (`RW1990V2`)

Other writable families and read-only tags are rejected before programming. Reads also require family code `0x01` and a valid Dallas/Maxim CRC-8.

## Write-safety flow

Writing is deliberately conservative:

1. Validate the requested six-byte serial number and build a complete `0x01 + serial + CRC-8` ROM.
2. Read the attached iButton twice and require two identical, CRC-valid results.
3. Reject unsupported family codes.
4. Return success without entering write mode when the ROM already matches the requested value.
5. Detect the writable RW1990 type exactly once.
6. Read the iButton twice again and confirm that the same tag is still present before programming starts.
7. Run exactly one programming algorithm exactly once.
8. Read the programmed ROM back and require two matching reads of all eight bytes.
9. Return `OK` only after read-back verification succeeds.

The firmware never cycles blindly through multiple programming algorithms. Errors detected before programming explicitly report that no serial number was written. Errors during or after programming warn that the tag must not be trusted until it has been read and rewritten successfully.

No software can make an interrupted physical write risk-free. Keep the iButton firmly against the reader until the interface reports that verification has finished. Validate new hardware and new batches of RW1990 tags on expendable test units before using important tags.

## Web interface

The normal workflow remains intentionally small:

1. Connect the programmer.
2. Read an existing iButton or enter/paste a six-byte serial number.
3. Press **Write** and keep the iButton in place until verification finishes.

The Write button has a darker visual treatment because it changes the tag. During Read, Detect, and Write operations, inputs and competing actions are disabled. Write remains disabled until all six bytes are valid.

Pasting supports all of these forms:

```text
11 22 33 44 55 66
112233445566
11.22.33.44.55.66
11:22:33:44:55:66
11-22-33-44-55-66
```

The collapsed **Debug** section contains writable-type detection, the raw protocol log, Copy, and Clear.

## Product protocol

Serial settings: **9600 baud, 8 data bits, no parity, 1 stop bit**.

Commands and responses are newline-terminated ASCII.

### Identify the programmer

```text
INFO
```

```text
OK INFO PRODUCT=IBUTTON_PROGRAMMER FW=0.4.0 PROTO=3 BOARD=NANO328P
```

`PING` returns the same identity response.

### Read

```text
READ
```

```text
OK READ 11 22 33 44 55 66
```

### Detect writable type

```text
DETECT
```

```text
OK DETECT TYPE=RW1990V1
```

Detection is a diagnostic operation and remains in the Debug section.

### Write

```text
WRITE 11 22 33 44 55 66
```

Successful verified write:

```text
OK WRITE TYPE=RW1990V1
```

No-op because the tag already matches:

```text
OK WRITE STATUS=UNCHANGED
```

Errors use stable machine-readable codes, for example:

```text
ERROR NO_BUTTON
ERROR UNSTABLE_CONTACT_BEFORE_WRITE
ERROR NOT_WRITABLE_OR_UNSUPPORTED
ERROR BUTTON_REMOVED_BEFORE_WRITE
ERROR WRITE_INTERRUPTED
ERROR VERIFY_FAILED
```

## Firmware installation

Open the browser installer, disconnect any iButton from the reader, and connect the Nano by USB.

Before reporting success, the installer:

1. downloads a versioned firmware manifest and Intel HEX file;
2. validates the manifest, file size, SHA-256 digest, Intel HEX checksums, address range, and AVR reset vector;
3. synchronizes with a common Nano bootloader at 115200 or 57600 baud;
4. checks for the ATmega328P signature `1E 95 0F` before writing;
5. programs only the 30,720-byte Nano application area, leaving the bootloader protected;
6. reads the programmed application area back and compares it byte for byte.

The installer reports success only after complete read-back verification passes.

## Build and tests

Firmware dependencies and the AVR platform are pinned in `firmware/platformio.ini`.

```bash
cd firmware
pio run --environment nanoatmega328
```

Web protocol and Intel HEX parser tests:

```bash
cd web
npm test
```

GitHub Actions compiles the firmware and runs the web tests before deploying the site. The Pages workflow publishes a manifest containing the firmware version, protocol version, file size, and SHA-256 digest.

## Repository structure

- `firmware/src/main.cpp` — Nano firmware and product protocol
- `firmware/platformio.ini` — pinned build configuration
- `web/index.html` — reader/programmer UI
- `web/app.js` — Web Serial client
- `web/protocol.js` — protocol parsing and user-facing error mapping
- `web/install.html` — firmware installer UI
- `web/nano-installer.js` — STK500v1 programmer and read-back verifier
- `web/intel-hex.js` — strict Intel HEX parser
- `web/tests/` — web unit tests
- `.github/workflows/firmware.yml` — firmware CI build and artifact
- `.github/workflows/pages.yml` — build, tests, manifest generation, and Pages deployment

See `THIRD_PARTY_NOTICES.md` for required dependency notices.
