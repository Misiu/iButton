#include <Arduino.h>
#include <iButtonTag.h>

static constexpr uint8_t IBUTTON_PIN = 2;
static constexpr uint8_t LED_PIN = 4;
static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr uint32_t TOUCH_TIMEOUT_MS = 5000;
static constexpr uint32_t VERIFY_TIMEOUT_MS = 1000;
static constexpr uint32_t POLL_INTERVAL_MS = 25;
static constexpr uint32_t VERIFY_DELAY_MS = 100;
static constexpr size_t COMMAND_BUFFER_SIZE = 32;
static const char FW_VERSION[] = "0.4.0";
static const char PROTOCOL_VERSION[] = "3";

iButtonTag iButton(IBUTTON_PIN);

char commandBuffer[COMMAND_BUFFER_SIZE];
size_t commandLength = 0;
bool commandOverflow = false;

void setLed(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

bool isSupportedWritableType(int8_t type) {
  return type == IBUTTON_RW1990V1 || type == IBUTTON_RW1990V2;
}

const __FlashStringHelper *typeName(int8_t type) {
  switch (type) {
    case IBUTTON_RW1990V1: return F("RW1990V1");
    case IBUTTON_RW1990V2: return F("RW1990V2");
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

void printReadError(int8_t status) {
  if (status == -1) Serial.println(F("ERROR ROM_CRC"));
  else if (status == -2) Serial.println(F("ERROR INVALID_BUTTON_DATA"));
  else Serial.println(F("ERROR NO_BUTTON"));
}

int8_t hexNibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  return -1;
}

bool parseSerial(const char *text, uint8_t rom[8]) {
  // Product protocol is deliberately strict: exactly six hexadecimal bytes
  // separated by one space, e.g. "12 34 56 78 9A BC".
  if (strlen(text) != 17) return false;

  uint8_t serial[6];
  for (uint8_t i = 0; i < 6; ++i) {
    const size_t offset = static_cast<size_t>(i) * 3;
    const int8_t high = hexNibble(text[offset]);
    const int8_t low = hexNibble(text[offset + 1]);
    if (high < 0 || low < 0) return false;
    if (i < 5 && text[offset + 2] != ' ') return false;
    serial[i] = static_cast<uint8_t>((high << 4) | low);
  }

  rom[0] = 0x01;
  for (uint8_t i = 0; i < 6; ++i) rom[i + 1] = serial[5 - i];
  iButtonTag::updateChecksum(rom);
  return iButtonTag::testCode(rom) > 0;
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

  if (status < 1) {
    printReadError(status);
    return;
  }

  Serial.print(F("OK READ "));
  printSerial(rom);
  Serial.println();
}

void handleDetect() {
  uint8_t rom[8];
  setLed(true);

  const int8_t readStatus = waitForRead(rom, TOUCH_TIMEOUT_MS);
  if (readStatus < 1) {
    setLed(false);
    printReadError(readStatus);
    return;
  }

  // Detection can touch writable-tag control flags. Run it once, and only
  // after a stable, CRC-valid tag has already been read.
  const int8_t type = iButton.detectWritableType();
  setLed(false);

  if (isSupportedWritableType(type)) {
    Serial.print(F("OK DETECT TYPE="));
    Serial.println(typeName(type));
  } else if (type < 0) {
    Serial.println(F("ERROR BUTTON_REMOVED"));
  } else if (type > 0) {
    Serial.println(F("ERROR UNSUPPORTED_TYPE"));
  } else {
    Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
  }
}

enum class VerifyResult : uint8_t {
  MATCH,
  NO_BUTTON,
  INVALID_DATA,
  MISMATCH
};

VerifyResult verifyWrittenRom(const uint8_t expected[8]) {
  const uint32_t start = millis();
  bool sawInvalidData = false;

  while (millis() - start < VERIFY_TIMEOUT_MS) {
    uint8_t actual[8];
    const int8_t status = iButton.readCode(actual);

    if (status > 0) {
      return iButtonTag::equalCode(actual, expected)
        ? VerifyResult::MATCH
        : VerifyResult::MISMATCH;
    }

    if (status < 0) sawInvalidData = true;
    delay(POLL_INTERVAL_MS);
  }

  return sawInvalidData ? VerifyResult::INVALID_DATA : VerifyResult::NO_BUTTON;
}

void handleWrite(const char *argument) {
  uint8_t targetRom[8];
  if (!parseSerial(argument, targetRom)) {
    Serial.println(F("ERROR INVALID_SERIAL"));
    return;
  }

  setLed(true);

  // Read-only preflight: wait for one stable, CRC-valid tag.
  uint8_t originalRom[8];
  const int8_t readStatus = waitForRead(originalRom, TOUCH_TIMEOUT_MS);
  if (readStatus < 1) {
    setLed(false);
    printReadError(readStatus);
    return;
  }

  // Avoid programming entirely when the requested value is already present.
  if (iButtonTag::equalCode(originalRom, targetRom)) {
    setLed(false);
    Serial.println(F("OK WRITE UNCHANGED"));
    return;
  }

  // Detect exactly once. Only the two supported RW1990 families may proceed.
  const int8_t type = iButton.detectWritableType();
  if (!isSupportedWritableType(type)) {
    setLed(false);
    if (type < 0) Serial.println(F("ERROR BUTTON_REMOVED"));
    else if (type > 0) Serial.println(F("ERROR UNSUPPORTED_TYPE"));
    else Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
    return;
  }

  // Make sure the same tag is still present immediately before programming.
  uint8_t confirmRom[8];
  const int8_t confirmStatus = iButton.readCode(confirmRom);
  if (confirmStatus < 1) {
    setLed(false);
    Serial.println(F("ERROR BUTTON_REMOVED"));
    return;
  }
  if (!iButtonTag::equalCode(originalRom, confirmRom)) {
    setLed(false);
    Serial.println(F("ERROR BUTTON_CHANGED"));
    return;
  }

  // Type is already known and target ROM is valid. Disable library-level
  // re-detection so exactly one programming algorithm is executed once.
  const int8_t writeStatus = iButton.writeCode(targetRom, type, false);
  if (writeStatus < 1) {
    setLed(false);
    Serial.println(writeStatus == 0 ? F("ERROR BUTTON_REMOVED") : F("ERROR WRITE_FAILED"));
    return;
  }

  delay(VERIFY_DELAY_MS);
  const VerifyResult verifyResult = verifyWrittenRom(targetRom);
  setLed(false);

  if (verifyResult == VerifyResult::NO_BUTTON) {
    Serial.println(F("ERROR VERIFY_READ_FAILED"));
    return;
  }
  if (verifyResult == VerifyResult::INVALID_DATA || verifyResult == VerifyResult::MISMATCH) {
    Serial.println(F("ERROR VERIFY_FAILED"));
    return;
  }

  Serial.print(F("OK WRITE TYPE="));
  Serial.println(typeName(type));
}

void uppercaseAscii(char *text) {
  while (*text) {
    if (*text >= 'a' && *text <= 'z') *text = static_cast<char>(*text - 'a' + 'A');
    ++text;
  }
}

char *trimAscii(char *text) {
  while (*text == ' ' || *text == '\t') ++text;
  char *end = text + strlen(text);
  while (end > text && (end[-1] == ' ' || end[-1] == '\t')) --end;
  *end = '\0';
  return text;
}

void processCommand(char *rawCommand) {
  char *command = trimAscii(rawCommand);
  if (!*command) return;

  char *separator = strchr(command, ' ');
  char *argument = nullptr;
  if (separator) {
    *separator = '\0';
    argument = trimAscii(separator + 1);
  }
  uppercaseAscii(command);

  if (strcmp(command, "INFO") == 0 || strcmp(command, "PING") == 0) {
    if (argument && *argument) Serial.println(F("ERROR INVALID_ARGUMENT"));
    else handleInfo();
  } else if (strcmp(command, "READ") == 0) {
    if (argument && *argument) Serial.println(F("ERROR INVALID_ARGUMENT"));
    else handleRead();
  } else if (strcmp(command, "DETECT") == 0) {
    if (argument && *argument) Serial.println(F("ERROR INVALID_ARGUMENT"));
    else handleDetect();
  } else if (strcmp(command, "WRITE") == 0) {
    if (!argument || !*argument) Serial.println(F("ERROR INVALID_SERIAL"));
    else handleWrite(argument);
  } else {
    Serial.println(F("ERROR UNKNOWN_COMMAND"));
  }
}

void resetCommandBuffer() {
  commandLength = 0;
  commandOverflow = false;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  setLed(false);
  Serial.begin(SERIAL_BAUD);
}

void loop() {
  while (Serial.available() > 0) {
    const char value = static_cast<char>(Serial.read());

    if (value == '\r') continue;

    if (value == '\n') {
      if (commandOverflow) {
        Serial.println(F("ERROR LINE_TOO_LONG"));
      } else {
        commandBuffer[commandLength] = '\0';
        processCommand(commandBuffer);
      }
      resetCommandBuffer();
      continue;
    }

    if (value < 0x20 || value > 0x7E) {
      commandOverflow = true;
      continue;
    }

    if (commandLength < COMMAND_BUFFER_SIZE - 1) {
      commandBuffer[commandLength++] = value;
    } else {
      commandOverflow = true;
    }
  }
}
