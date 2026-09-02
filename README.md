# iButton Programmer

Web-based iButton reader/programmer using Web Serial, with firmware targeting the Seeed Studio XIAO ESP32-C3.

**Web programmer:** https://ibutton.jagusz.xyz/

## Compatibility

The web application preserves the serial protocol used by the legacy Arduino Nano programmer, so the same page can be used with the existing Mini-USB device before migrating the hardware to XIAO ESP32-C3.

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

### Probe wiring

The legacy programmer was measured with the probe connected. Arduino Nano D2 sits at approximately 5 V while the LED is off, drops to approximately 0 V while the LED is on, and returns to approximately 5 V afterwards. Together with the resistor in the LED branch, this identifies D2 as an active-low LED sink. The other signal pin, D4, is therefore used for 1-Wire.

The XIAO firmware keeps the same D2/D4 board labels while using their XIAO ESP32-C3 GPIO mappings:

| Function | XIAO pin | ESP32-C3 GPIO | Connection |
| --- | --- | --- | --- |
| iButton 1-Wire data | D4 | GPIO6 | Probe 1-Wire data |
| Probe LED control | D2 | GPIO4 | LED cathode/control side, active-low |
| LED supply | 3V3 | 3.3 V | Existing probe LED resistor/anode supply |
| Ground | GND | GND | Probe/iButton ground |

The LED branch is intentionally powered from XIAO `3V3`, not from 5 V. Keep the probe's existing series/current-limiting resistor in circuit. With the measured active-low arrangement, GPIO4 is HIGH while the LED is off and LOW while the LED is on, so the GPIO sinks the LED current. Using 3.3 V instead of the legacy 5 V reduces LED current and may reduce brightness, which is acceptable for the status indicator.

Do **not** connect the legacy 5 V LED supply to an ESP32-C3 GPIO. All GPIO-side signals in the new programmer are 3.3 V.

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

The RW1990/TM1990 write sequence in the new ESP32-C3 firmware is provisional until verified against the original Arduino firmware or tested with the actual writable tokens. The web application's legacy serial protocol does not depend on this and can already be tested with the existing Arduino Nano programmer.

## Web app

Open https://ibutton.jagusz.xyz/ in a Web Serial capable browser, connect the programmer and use:

- **Read** — reads the iButton ROM and displays its six-byte serial number
- **Write** — builds the complete family/serial/CRC ROM and sends it to the programmer

Web Serial requires HTTPS or localhost for development.

## Firmware

The current firmware prototype uses PlatformIO with the Arduino framework:

```bash
cd firmware
pio run
```

Arduino was chosen initially to keep the prototype small and to reuse the mature OneWire library. For production firmware, especially when serial firmware updates, OTA partitions, rollback and stricter device/version handling are added, moving the firmware to ESP-IDF is a reasonable next step without changing the browser protocol.
