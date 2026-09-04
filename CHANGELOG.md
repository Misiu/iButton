# Changelog

## 0.4.0 — 2026-09-04

### Firmware

- Kept product protocol version 3 and raised the supported firmware baseline to 0.4.0.
- Replaced dynamic command strings with a fixed-size serial command buffer.
- Restricted programming to detected RW1990V1 and RW1990V2 tags.
- Added family-code validation and strict serial-command parsing.
- Added two-read stability checks before detection and immediately before writing.
- Added a no-write success path when the requested ROM already matches.
- Ensured that type detection runs once and exactly one write algorithm is attempted once.
- Added repeated, full eight-byte read-back verification after programming.
- Added distinct errors for pre-write contact loss, unstable contact, interrupted writes, and verification failures.

### Web programmer

- Added a darker Write button and clearer in-progress and verified-success messages.
- Disabled Write until all six serial bytes are valid.
- Locked serial fields and competing actions while an operation is active.
- Added a persistent serial read loop and command-specific response matching.
- Required firmware 0.4.0 or newer during programmer identification.
- Improved safety-oriented error messages while retaining raw codes in Debug logs.
- Kept Detect type, Copy, Clear, and raw traffic inside the collapsed Debug section.
- Added protocol parser tests.

### Firmware installer

- Added versioned firmware manifest generation in CI.
- Added SHA-256, file-size, Intel HEX, address-range, and reset-vector validation.
- Added ATmega328P signature validation before flash programming.
- Added complete byte-for-byte application-flash read-back verification.
- Added automatic and manual-reset bootloader connection flows for 115200 and 57600 baud.
- Added an unload guard and disabled navigation while installation is active.

### Build and deployment

- Pinned PlatformIO Core, the AVR platform, and firmware dependencies.
- Updated GitHub Actions to current Node 24-based major versions.
- Added web tests and JavaScript syntax validation to the Pages deployment gate.
- Excluded the temporary firmware-dump utility and test sources from the published Pages artifact.
