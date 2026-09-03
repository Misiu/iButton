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
static constexpr uint32_t RW1990_PROGRAM_DELAY_MS = 10;

OneWire oneWire(IBUTTON_PIN);

void setProbeLed(bool on) {
  const bool level = LED_ACTIVE_HIGH ? on : !on;
  digitalWrite(LED_PIN, level ? HIGH : LOW);
}

void releaseOneWireLine() {
  pinMode(IBUTTON_PIN, INPUT);
}

void pullOneWireLow(uint32_t microseconds) {
  pinMode(IBUTTON_PIN, OUTPUT);
  digitalWrite(IBUTTON_PIN, LOW);
  if (microseconds > 0) delayMicroseconds(microseconds);
  releaseOneWireLine();
}

void programRw1990Bit(bool one) {
  // RW1990 programming timing used by the reference Arduino duplicator:
  // logical 1 => ~60 us LOW pulse, then release for ~10 ms
  // logical 0 => release immediately after asserting LOW, then wait ~10 ms
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
  // Enable write mode: reset, 0xD1, then program logical 0.
  if (!oneWire.reset()) return false;
  oneWire.write(0xD1);
  pullOneWireLow(60);
  delay(RW1990_PROGRAM_DELAY_MS);

  // Write the complete 8-byte ROM, LSB first, using the RW1990 programming timing.
  if (!oneWire.reset()) return false;
  oneWire.write(0xD5);
  for (size_t byteIndex = 0; byteIndex < 8; ++byteIndex) {
    programRw1990Byte(rom[byteIndex]);
  }

  // Disable write mode: reset, 0xD1, then program logical 1.
  if (!oneWire.reset()) return false;
  oneWire.write(0xD1);
  pullOneWireLow(10);
  delay(RW1990_PROGRAM_DELAY_MS);

  // Verify by reading the programmed ROM back.
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
