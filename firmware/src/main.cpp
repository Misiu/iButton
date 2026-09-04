#include <Arduino.h>
#include <iButtonTag.h>

static constexpr uint8_t IBUTTON_PIN = 2;
static constexpr uint8_t LED_PIN = 4;
static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr uint32_t TOUCH_TIMEOUT_MS = 5000;
static constexpr uint32_t POLL_INTERVAL_MS = 20;
static const char FW_VERSION[] = "0.3.0";
static const char PROTOCOL_VERSION[] = "3";

iButtonTag iButton(IBUTTON_PIN);

void setLed(bool on) { digitalWrite(LED_PIN, on ? HIGH : LOW); }

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

bool parseSerial(const String &text, uint8_t rom[8]) {
  String hex;
  hex.reserve(12);
  for (size_t i = 0; i < text.length(); ++i) {
    const char c = text[i];
    if (isxdigit(c)) hex += static_cast<char>(toupper(c));
  }
  if (hex.length() != 12) return false;

  uint8_t serial[6];
  for (uint8_t i = 0; i < 6; ++i) {
    const char pair[3] = { hex[i * 2], hex[i * 2 + 1], '\0' };
    serial[i] = static_cast<uint8_t>(strtoul(pair, nullptr, 16));
  }

  rom[0] = 0x01;
  for (uint8_t i = 0; i < 6; ++i) rom[i + 1] = serial[5 - i];
  iButtonTag::updateChecksum(rom);
  return true;
}

void printSerial(const uint8_t rom[8]) {
  for (int8_t i = 6; i >= 1; --i) {
    if (rom[i] < 0x10) Serial.print('0');
    Serial.print(rom[i], HEX);
    if (i != 1) Serial.print(' ');
  }
}

void handleInfo() {
  Serial.print(F("OK INFO PRODUCT=IBUTTON_PROGRAMMER FW="));
  Serial.print(FW_VERSION);
  Serial.print(F(" PROTO="));
  Serial.print(PROTOCOL_VERSION);
  Serial.println(F(" BOARD=NANO328P"));
}

void handleRead() {
  uint8_t rom[8];
  setLed(true);
  const int8_t status = waitForRead(rom, TOUCH_TIMEOUT_MS);
  setLed(false);

  if (status > 0) {
    Serial.print(F("OK READ "));
    printSerial(rom);
    Serial.println();
  } else if (status == -1) {
    Serial.println(F("ERROR ROM_CRC"));
  } else {
    Serial.println(F("ERROR NO_BUTTON"));
  }
}

void handleDetect() {
  setLed(true);
  const int8_t type = waitForWritableType(TOUCH_TIMEOUT_MS);
  setLed(false);

  if (type > 0) {
    Serial.print(F("OK DETECT TYPE="));
    Serial.println(typeName(type));
  } else {
    Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
  }
}

void handleWrite(const String &argument) {
  uint8_t rom[8];
  if (!parseSerial(argument, rom)) {
    Serial.println(F("ERROR INVALID_SERIAL"));
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
    Serial.print(F("OK WRITE TYPE="));
    Serial.println(typeName(type));
  } else if (result == 0) {
    Serial.println(F("ERROR BUTTON_REMOVED"));
  } else if (result == -21) {
    Serial.println(F("ERROR VERIFY_FAILED"));
  } else if (result == -13) {
    Serial.println(F("ERROR TYPE_CHANGED"));
  } else {
    Serial.print(F("ERROR WRITE_FAILED CODE="));
    Serial.println(result);
  }
}

void processCommand(String command) {
  command.trim();
  if (!command.length()) return;

  const int separator = command.indexOf(' ');
  String name = separator < 0 ? command : command.substring(0, separator);
  String argument = separator < 0 ? String() : command.substring(separator + 1);
  name.toUpperCase();

  if (name == "INFO" || name == "PING") handleInfo();
  else if (name == "READ") handleRead();
  else if (name == "DETECT") handleDetect();
  else if (name == "WRITE") handleWrite(argument);
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
  processCommand(Serial.readStringUntil('\n'));
}
