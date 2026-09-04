#include <Arduino.h>
#include <OneWire.h>

#ifndef IBUTTON_PIN
#define IBUTTON_PIN 4
#endif

#ifndef LED_PIN
#define LED_PIN 6
#endif

#ifndef LED_ACTIVE_HIGH
#define LED_ACTIVE_HIGH 1
#endif

static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr size_t COMMAND_SIZE = 11;
static constexpr uint32_t TOUCH_TIMEOUT_MS = 10000;
static constexpr uint32_t RW1990_PROGRAM_DELAY_MS = 10;
static constexpr uint32_t VERIFY_TIMEOUT_MS = 1200;

OneWire oneWire(IBUTTON_PIN);

void setProbeLed(bool on) {
  const bool level = LED_ACTIVE_HIGH ? on : !on;
  digitalWrite(LED_PIN, level ? HIGH : LOW);
}

void releaseOneWireLine() {
  pinMode(IBUTTON_PIN, INPUT);
}

void programRw1990Bit(bool one) {
  pinMode(IBUTTON_PIN, OUTPUT);
  digitalWrite(IBUTTON_PIN, LOW);
  if (one) delayMicroseconds(60);
  releaseOneWireLine();
  delay(RW1990_PROGRAM_DELAY_MS);
}

void programRw1990Byte(uint8_t value) {
  for (uint8_t bit = 0; bit < 8; ++bit) {
    programRw1990Bit((value & 0x01) != 0);
    value >>= 1;
  }
}

void programRw1990Rom(const uint8_t rom[8], bool invertBytes) {
  for (size_t i = 0; i < 8; ++i) {
    programRw1990Byte(invertBytes ? static_cast<uint8_t>(~rom[i]) : rom[i]);
  }
}

uint8_t additiveChecksum(const uint8_t *data, size_t length) {
  uint8_t sum = 0;
  for (size_t i = 0; i < length; ++i) sum += data[i];
  return sum;
}

bool waitForRom(uint8_t rom[8], uint32_t timeoutMs) {
  const uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    oneWire.reset_search();
    if (oneWire.search(rom)) {
      if (OneWire::crc8(rom, 7) != rom[7]) {
        delay(50);
        continue;
      }
      return true;
    }
    delay(25);
  }
  return false;
}

bool verifyRom(const uint8_t expected[8]) {
  uint8_t actual[8];
  return waitForRom(actual, VERIFY_TIMEOUT_MS) && memcmp(actual, expected, 8) == 0;
}

void printRom(const uint8_t rom[8]) {
  for (size_t i = 0; i < 8; ++i) {
    if (i) Serial.print(' ');
    if (rom[i] < 0x10) Serial.print('0');
    Serial.print(rom[i], HEX);
  }
  Serial.println();
}

// First try: exact programming sequence recovered from the known-working legacy Nano.
bool writeLegacyNano(const uint8_t rom[8]) {
  oneWire.skip();                 // 0xCC
  oneWire.reset();
  oneWire.write(0x33);            // Read ROM preamble used by the legacy firmware
  oneWire.skip();                 // 0xCC
  oneWire.reset();
  oneWire.write(0xD5);            // Write ROM
  programRw1990Rom(rom, false);
  oneWire.reset();
  return verifyRom(rom);
}

void setRwWriteFlag(uint8_t command, bool flag) {
  oneWire.reset();
  oneWire.write(command);
  oneWire.write_bit(flag ? 1 : 0);
  delay(10);
  releaseOneWireLine();
}

// RW1990.1 algorithm used by common Arduino duplicators:
// D1 flag is inverted; bytes are programmed inverted.
bool writeRw1990_1(const uint8_t rom[8]) {
  setRwWriteFlag(0xD1, false);     // enable write
  if (!oneWire.reset()) return false;
  oneWire.write(0xD5);
  programRw1990Rom(rom, true);
  setRwWriteFlag(0xD1, true);      // disable write
  return verifyRom(rom);
}

// RW1990.2 algorithm used by common Arduino duplicators:
// 1D flag has normal polarity; bytes are programmed normally.
bool writeRw1990_2(const uint8_t rom[8]) {
  setRwWriteFlag(0x1D, true);      // enable write
  if (!oneWire.reset()) {
    setRwWriteFlag(0x1D, false);
    return false;
  }
  oneWire.write(0xD5);
  programRw1990Rom(rom, false);
  setRwWriteFlag(0x1D, false);     // disable write
  return verifyRom(rom);
}

bool writeRw1990(const uint8_t rom[8]) {
  if (writeLegacyNano(rom)) return true;
  if (writeRw1990_1(rom)) return true;
  if (writeRw1990_2(rom)) return true;
  return false;
}

void handleRead() {
  setProbeLed(true);
  uint8_t rom[8];
  const bool found = waitForRom(rom, TOUCH_TIMEOUT_MS);
  setProbeLed(false);

  if (!found) {
    Serial.println("ERROR NO_BUTTON");
    return;
  }
  printRom(rom);
}

void handleWrite(const uint8_t command[COMMAND_SIZE]) {
  const uint8_t *rom = command + 2;
  if (OneWire::crc8(rom, 7) != rom[7]) {
    Serial.println("ERROR ROM_CRC");
    return;
  }

  setProbeLed(true);
  uint8_t currentRom[8];
  if (!waitForRom(currentRom, TOUCH_TIMEOUT_MS)) {
    setProbeLed(false);
    Serial.println("ERROR NO_BUTTON");
    return;
  }

  const bool written = writeRw1990(rom);
  setProbeLed(false);

  if (!written) {
    Serial.println("ERROR WRITE_FAILED");
    return;
  }
  Serial.println("OK");
}

void processCommand(const uint8_t command[COMMAND_SIZE]) {
  if (additiveChecksum(command, COMMAND_SIZE - 1) != command[COMMAND_SIZE - 1]) {
    Serial.println("ERROR COMMAND_CHECKSUM");
    return;
  }

  if (command[0] == 0x01 && command[1] == 0x01) {
    handleRead();
    return;
  }
  if (command[0] == 0x00 && command[1] == 0x01) {
    handleWrite(command);
    return;
  }
  Serial.println("ERROR UNKNOWN_COMMAND");
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  setProbeLed(false);
  releaseOneWireLine();
  Serial.begin(SERIAL_BAUD);
}

void loop() {
  static uint8_t command[COMMAND_SIZE];
  static size_t received = 0;

  while (Serial.available() && received < COMMAND_SIZE) {
    command[received++] = static_cast<uint8_t>(Serial.read());
  }

  if (received == COMMAND_SIZE) {
    processCommand(command);
    received = 0;
  }
}
