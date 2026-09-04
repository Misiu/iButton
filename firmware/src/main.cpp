#include <Arduino.h>
#include <iButtonTag.h>

static constexpr uint8_t IBUTTON_PIN = 2;
static constexpr uint8_t LED_PIN = 4;
static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr size_t COMMAND_SIZE = 11;
static constexpr uint32_t TOUCH_TIMEOUT_MS = 5000;
static constexpr uint32_t POLL_INTERVAL_MS = 20;
static const char FW_VERSION[] = "0.2.0";

iButtonTag iButton(IBUTTON_PIN);

uint8_t additiveChecksum(const uint8_t *data, size_t length) {
  uint8_t sum = 0;
  for (size_t i = 0; i < length; ++i) sum += data[i];
  return sum;
}

void setLed(bool on) { digitalWrite(LED_PIN, on ? HIGH : LOW); }

void printRom(const uint8_t rom[8]) {
  for (uint8_t i = 0; i < 8; ++i) {
    if (rom[i] < 0x10) Serial.print('0');
    Serial.print(rom[i], HEX);
    if (i != 7) Serial.print(' ');
  }
  Serial.println();
}

const __FlashStringHelper *typeName(int8_t type) {
  switch (type) {
    case IBUTTON_RW1990V1: return F("RW1990V1");
    case IBUTTON_RW1990V2: return F("RW1990V2");
    case IBUTTON_RW2004: return F("RW2004");
    case IBUTTON_TM01: return F("TM01");
    default: return F("UNKNOWN");
  }
}

int8_t waitForRead(uint8_t rom[8], uint32_t timeoutMs) {
  const uint32_t start = millis();
  int8_t lastError = 0;
  while (millis() - start < timeoutMs) {
    const int8_t status = iButton.readCode(rom);
    if (status > 0) return status;
    if (status < 0) lastError = status;
    delay(POLL_INTERVAL_MS);
  }
  return lastError;
}

int8_t waitForWritableType(uint32_t timeoutMs) {
  const uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    const int8_t type = iButton.detectWritableType();
    if (type > 0) return type;
    delay(POLL_INTERVAL_MS);
  }
  return IBUTTON_UNKNOWN;
}

void handleRead() {
  uint8_t rom[8];
  setLed(true);
  const int8_t status = waitForRead(rom, TOUCH_TIMEOUT_MS);
  setLed(false);
  if (status > 0) printRom(rom);
  else if (status == -1) Serial.println(F("ERROR ROM_CRC"));
  else Serial.println(F("ERROR NO_BUTTON"));
}

void handleWrite(const uint8_t rom[8]) {
  if (iButtonTag::testCode(rom) < 1) {
    Serial.println(F("ERROR ROM_CRC"));
    return;
  }

  setLed(true);
  const int8_t type = waitForWritableType(TOUCH_TIMEOUT_MS);
  if (type == IBUTTON_UNKNOWN) {
    setLed(false);
    Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
    return;
  }

  const int8_t result = iButton.writeCode(rom, type, true);
  setLed(false);
  if (result > 0) {
    Serial.print(F("OK TYPE="));
    Serial.println(typeName(type));
  } else if (result == 0) Serial.println(F("ERROR BUTTON_REMOVED"));
  else if (result == -21) Serial.println(F("ERROR VERIFY_FAILED"));
  else if (result == -13) Serial.println(F("ERROR TYPE_CHANGED"));
  else {
    Serial.print(F("ERROR WRITE_FAILED "));
    Serial.println(result);
  }
}

void handleInfo() {
  Serial.print(F("INFO IBUTTON_PROGRAMMER FW="));
  Serial.print(FW_VERSION);
  Serial.println(F(" PROTO=2 BOARD=NANO328P LIB=IBUTTONTAG"));
}

void handleDetect() {
  setLed(true);
  const int8_t type = waitForWritableType(TOUCH_TIMEOUT_MS);
  setLed(false);
  if (type > 0) {
    Serial.print(F("TYPE "));
    Serial.println(typeName(type));
  } else Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
}

void processLegacyCommand(const uint8_t command[COMMAND_SIZE]) {
  if (additiveChecksum(command, COMMAND_SIZE - 1) != command[COMMAND_SIZE - 1]) {
    Serial.println(F("ERROR COMMAND_CHECKSUM"));
    return;
  }
  if (command[1] != 0x01) {
    Serial.println(F("ERROR UNKNOWN_COMMAND"));
    return;
  }
  if (command[0] == 0x01) handleRead();
  else if (command[0] == 0x00) handleWrite(command + 2);
  else Serial.println(F("ERROR UNKNOWN_COMMAND"));
}

void processTextCommand(String command) {
  command.trim();
  command.toUpperCase();
  if (command == "INFO" || command == "PING") handleInfo();
  else if (command == "DETECT") handleDetect();
  else Serial.println(F("ERROR UNKNOWN_COMMAND"));
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  setLed(false);
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(100);
}

void loop() {
  if (!Serial.available()) return;

  const int first = Serial.peek();
  if (first == 'I' || first == 'i' || first == 'P' || first == 'p' || first == 'D' || first == 'd') {
    processTextCommand(Serial.readStringUntil('\n'));
    return;
  }

  if (Serial.available() < COMMAND_SIZE) return;
  uint8_t command[COMMAND_SIZE];
  for (size_t i = 0; i < COMMAND_SIZE; ++i) command[i] = static_cast<uint8_t>(Serial.read());
  processLegacyCommand(command);
}
