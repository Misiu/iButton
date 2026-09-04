#include <Arduino.h>
#include <OneWire.h>

static constexpr uint8_t IBUTTON_PIN = 2;
static constexpr uint8_t LED_PIN = 4;
static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr size_t COMMAND_SIZE = 11;
static constexpr uint8_t READ_ATTEMPTS = 3;
static constexpr uint8_t WRITE_ATTEMPTS = 5;

OneWire oneWire(IBUTTON_PIN);

uint8_t additiveChecksum(const uint8_t *data, size_t length) {
  uint8_t sum = 0;
  for (size_t i = 0; i < length; ++i) sum += data[i];
  return sum;
}

bool findRom(uint8_t rom[8], uint8_t attempts) {
  for (uint8_t attempt = 0; attempt < attempts; ++attempt) {
    oneWire.reset_search();
    if (oneWire.search(rom)) return true;
    delay(1000);
  }
  return false;
}

void printRom(const uint8_t rom[8]) {
  for (uint8_t i = 0; i < 8; ++i) {
    if (rom[i] < 0x10) Serial.print('0');
    Serial.print(rom[i], HEX);
    if (i < 7) Serial.print(' ');
  }
  Serial.println();
}

void programBit(bool one) {
  digitalWrite(IBUTTON_PIN, LOW);
  pinMode(IBUTTON_PIN, OUTPUT);
  if (one) delayMicroseconds(60);
  pinMode(IBUTTON_PIN, INPUT);
  digitalWrite(IBUTTON_PIN, HIGH);
  delay(10);
}

void programByte(uint8_t value) {
  for (uint8_t bit = 0; bit < 8; ++bit) {
    programBit((value & 0x01) != 0);
    value >>= 1;
  }
}

void handleRead() {
  digitalWrite(LED_PIN, HIGH);

  uint8_t rom[8];
  if (!findRom(rom, READ_ATTEMPTS)) {
    Serial.println("ERROR: Timeout");
    digitalWrite(LED_PIN, LOW);
    return;
  }

  printRom(rom);
  digitalWrite(LED_PIN, LOW);
}

void handleWrite(const uint8_t command[COMMAND_SIZE]) {
  digitalWrite(LED_PIN, HIGH);

  uint8_t currentRom[8];
  if (!findRom(currentRom, WRITE_ATTEMPTS)) {
    Serial.println("ERROR: Timeout");
    digitalWrite(LED_PIN, LOW);
    return;
  }

  // Exact sequence recovered from the known-working legacy Arduino Nano firmware.
  oneWire.write(0xCC);
  oneWire.reset();
  oneWire.write(0x33);
  oneWire.write(0xCC);
  oneWire.reset();
  oneWire.write(0xD5);

  for (uint8_t i = 0; i < 8; ++i) programByte(command[i + 2]);

  oneWire.reset();
  Serial.println("OK");
  digitalWrite(LED_PIN, LOW);
}

void processCommand(const uint8_t command[COMMAND_SIZE]) {
  if (additiveChecksum(command, COMMAND_SIZE - 1) != command[COMMAND_SIZE - 1]) {
    Serial.println("ERROR:Invalid command");
    return;
  }

  if (command[0] == 0x00 && command[1] == 0x01) {
    handleWrite(command);
    return;
  }

  if (command[0] == 0x01 && command[1] == 0x01) {
    handleRead();
    return;
  }

  Serial.println("ERROR:Unknown command");
}

void setup() {
  pinMode(IBUTTON_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.begin(SERIAL_BAUD);
}

void loop() {
  if (Serial.available() < COMMAND_SIZE) return;

  uint8_t command[COMMAND_SIZE];
  for (size_t i = 0; i < COMMAND_SIZE; ++i) {
    command[i] = static_cast<uint8_t>(Serial.read());
  }
  processCommand(command);
}
