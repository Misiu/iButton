# iButton Programmer

Web-based iButton reader/programmer using Web Serial, with firmware targeting the Seeed Studio XIAO ESP32-C3.

**Web programmer:** https://misiu.github.io/iButton/

**Firmware installer:** https://misiu.github.io/iButton/install.html

## Compatibility

The web application preserves the serial protocol used by the legacy Arduino Nano programmer, so the same page can be used with the existing Mini-USB device before migrating the hardware to XIAO ESP32-C3.

Serial: 9600 baud, 8 data bits, no parity, 1 stop bit.

Legacy binary commands are 11 bytes:

- read: `01 01 00 00 00 00 00 00 00 00 02`
- write: `00 01 <8-byte ROM> <checksum>`

The final command byte is an 8-bit additive checksum of all previous command bytes.

The iButton ROM is 8 bytes: family byte `0x01`, six serial-number bytes and Dallas/Maxim CRC-8 as byte 8. The serial-number field shown in the UI contains only the six serial-number bytes in human-readable order.

For writes, the browser takes the six displayed serial bytes, reverses them into Dallas ROM byte order, prepends family byte `0x01`, calculates Dallas/Maxim CRC-8 over the first seven ROM bytes and appends that CRC as byte 8. The complete ROM is then wrapped in the legacy 11-byte write command. The XIAO firmware validates both the command checksum and ROM CRC before programming the RW1990.

## Structure

- `firmware/` — XIAO ESP32-C3 firmware
- `web/index.html` — normal Read/Write interface
- `web/install.html` — browser firmware installer for XIAO ESP32-C3
- `web/` — static site deployed to GitHub Pages
- `.github/workflows/pages.yml` — builds firmware and deploys the web UI plus installer
- `.github/workflows/firmware.yml` — firmware CI build

## Target hardware

Seeed Studio XIAO ESP32-C3.

### Probe wiring

The legacy programmer was measured with the probe connected. Arduino Nano D2 sits at approximately 5 V while the LED is off, drops to approximately 0 V while the LED is on, and returns to approximately 5 V afterwards. Together with the resistor in the LED branch, this identifies D2 as an active-low LED sink. The other signal pin, D4, is therefore used for 1-Wire.

The XIAO firmware keeps the same D2/D4 board labels while using their XIAO ESP32-C3 GPIO mappings:

| Function | XIAO pin | ESP32-C3 GPIO | Connection |
| --- | --- | --- | --- |
| iButton 1-Wire data | D4 | GPIO6 | Probe/iButton center DATA contact |
| Probe LED control | D2 | GPIO4 | LED cathode/control side, active-low |
| LED supply | 3V3 | 3.3 V | Existing probe LED resistor/anode supply |
| Ground | GND | GND | Probe/iButton outer contact |

The 1-Wire DATA line requires an external pull-up to 3.3 V. For the RW1990 programmer, use **2.2 kOhm between 3V3 and D4/GPIO6**. The iButton itself therefore still needs only two physical contacts: center DATA to D4/GPIO6 and outer shell to GND.

```text
3V3 ---- 2.2 kOhm ----+---- D4 / GPIO6
                      |
                      +---- iButton center DATA

GND ----------------------- iButton outer shell
```

The LED branch is intentionally powered from XIAO `3V3`, not from 5 V. Keep the probe's existing series/current-limiting resistor in circuit. With the measured active-low arrangement, GPIO4 is HIGH while the LED is off and LOW while the LED is on, so the GPIO sinks the LED current. Using 3.3 V instead of the legacy 5 V reduces LED current and may reduce brightness, which is acceptable for the status indicator.

Do **not** connect the legacy 5 V LED supply or a 5 V 1-Wire pull-up to an ESP32-C3 GPIO. All GPIO-side signals in the new programmer are 3.3 V.

Connect the probe by **function**, not by assumed wire color. Probe cable colors differ between variants. The metal outer contact is the iButton ground contact and the center contact carries the 1-Wire signal.

Firmware pin configuration in `firmware/platformio.ini`:

```ini
-D IBUTTON_PIN=6
-D LED_PIN=4
-D LED_ACTIVE_HIGH=0
```

### Operation

For both **Read** and **Write**, the firmware turns the probe LED on and waits up to 5 seconds for an iButton. If no valid iButton is detected within 5 seconds, the LED is turned off and `ERROR NO_BUTTON` is returned.

For **Read**, the LED is turned off immediately after a valid ROM is read. For **Write**, the LED stays on while the detected writable iButton is programmed and verified, then turns off before the result is returned.

RW1990 programming follows the reference Arduino duplicator sequence: enter write mode with `0xD1`, write the complete 8-byte ROM after `0xD5` LSB-first using the RW1990 programming pulses and approximately 10 ms programming time per bit, then use `0xD1` again to leave write mode. The firmware reads the ROM back afterwards and only returns `OK` when all 8 bytes match the requested ROM.

The current implementation targets RW1990/RW1990.2-style writable tokens. Other writable iButton clone families can use different programming protocols.

## Web app

Open https://misiu.github.io/iButton/ in a Web Serial capable browser, connect the programmer and use:

- **Read** — reads the iButton ROM and displays its six-byte serial number
- **Write** — builds the complete family/serial/CRC ROM and sends it to the programmer

Web Serial requires HTTPS or localhost for development.

## Firmware installation

Open https://misiu.github.io/iButton/install.html in a Chromium-based browser and connect the XIAO ESP32-C3 by USB-C. The installer uses ESP Web Tools and flashes the firmware binaries produced by the same PlatformIO build that is deployed with the site.

If a blank or corrupted XIAO does not enter the serial bootloader automatically, put it into the ESP32-C3 download mode and run the installer again.

## Firmware

The current firmware prototype uses PlatformIO with the Arduino framework:

```bash
cd firmware
pio run
```

Arduino was chosen initially to keep the prototype small and to reuse the mature OneWire library. For production firmware, especially when application-level firmware updates, rollback and stricter device/version handling are added, moving the firmware to ESP-IDF remains possible without changing the browser protocol.
