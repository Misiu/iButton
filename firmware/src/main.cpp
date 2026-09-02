#include <Arduino.h>
#include <OneWire.h>

#ifndef IBUTTON_PIN
#define IBUTTON_PIN 6
#endif

#ifndef LED_PIN
#define LED_PIN 4
#endif

#ifndef LED_ACTIVE_HIGH
#define LED_ACTIVE_HIGH 0
#endif

static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr size_t COMMAND_SIZE = 11;
static constexpr uint32_t TOUCH_TIMEOUT_MS = 5000;

OneWire oneWire(IBUTTON_PIN);

void setProbeLed(bool on) {
  const bool level = LED_ACTIVE_HIGH ? on : !on;
  digitalWrite(LED_PIN, level ? HIGH : LOW);
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

void printRom(const uint8_t rom[8]) {
  for (size_t i = 0; i < 8; ++i) {
    if (i) Serial.print(' ');
    if (rom[i] < 0x10) Serial.print('0');
    Serial.print(rom[i], HEX);
  }
  Serial.println();
}

bool writeRw1990(const uint8_t rom[8]) {
  // Provisional RW1990/TM1990-compatible sequence. Verify against the legacy
  // programmer firmware / actual tokens before treating this as production-ready.
  if (!oneWire.reset()) return false;
  oneWire.write(0xD1);
  oneWire.write_bit(0);
  delay(10);

  if (!oneWire.reset()) return false;
  oneWire.write(0xD5);
  for (size_t byteIndex = 0; byteIndex < 8; ++byteIndex) {
    uint8_t value = rom[byteIndex];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      oneWire.write_bit(value & 0x01);
      value >>= 1;
      delay(10);
    }
  }

  if (!oneWire.reset()) return false;
  oneWire.write(0xD1);
  oneWire.write_bit(1);
  delay(10);

  uint8_t verify[8];
  return waitForRom(verify, 1000) && memcmp(verify, rom, 8) == 0;
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
