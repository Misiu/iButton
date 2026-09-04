#include <Arduino.h>
#include <ctype.h>
#include <string.h>
#include <iButtonTag.h>

static constexpr uint8_t IBUTTON_PIN = 2;
static constexpr uint8_t LED_PIN = 4;
static constexpr uint8_t SUPPORTED_FAMILY_CODE = 0x01;
static constexpr uint32_t SERIAL_BAUD = 9600;
static constexpr uint32_t TOUCH_TIMEOUT_MS = 5000;
static constexpr uint32_t POLL_INTERVAL_MS = 25;
static constexpr uint32_t STABLE_READ_GAP_MS = 60;
static constexpr uint32_t PREWRITE_CONFIRM_TIMEOUT_MS = 800;
static constexpr uint32_t VERIFY_DELAY_MS = 100;
static constexpr uint32_t VERIFY_TIMEOUT_MS = 1200;
static constexpr size_t COMMAND_BUFFER_SIZE = 32;
static const char FW_VERSION[] = "0.4.0";
static const char PROTOCOL_VERSION[] = "3";

static constexpr int8_t READ_STATUS_UNSTABLE = -3;
static constexpr int8_t CONFIRM_STATUS_DIFFERENT = -4;

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

bool isSupportedFamily(const uint8_t rom[8]) {
  return rom[0] == SUPPORTED_FAMILY_CODE;
}

const __FlashStringHelper *typeName(int8_t type) {
  switch (type) {
    case IBUTTON_RW1990V1: return F("RW1990V1");
    case IBUTTON_RW1990V2: return F("RW1990V2");
    default: return F("UNKNOWN");
  }
}

void printReadFailure(int8_t status) {
  if (status == -1) {
    Serial.println(F("ERROR ROM_CRC"));
  } else if (status == -2) {
    Serial.println(F("ERROR INVALID_BUTTON_DATA"));
  } else if (status == READ_STATUS_UNSTABLE) {
    Serial.println(F("ERROR UNSTABLE_CONTACT"));
  } else {
    Serial.println(F("ERROR NO_BUTTON"));
  }
}

int8_t waitForStableRead(uint8_t rom[8], uint32_t timeoutMs) {
  const uint32_t startedAt = millis();
  int8_t lastError = 0;
  bool sawUnstableRead = false;

  while (millis() - startedAt < timeoutMs) {
    uint8_t first[8];
    const int8_t firstStatus = iButton.readCode(first);
    if (firstStatus > 0) {
      delay(STABLE_READ_GAP_MS);

      uint8_t second[8];
      const int8_t secondStatus = iButton.readCode(second);
      if (secondStatus > 0 && iButtonTag::equalCode(first, second)) {
        memcpy(rom, second, sizeof(second));
        return 1;
      }

      sawUnstableRead = true;
      if (secondStatus < 0) lastError = secondStatus;
    } else if (firstStatus < 0) {
      lastError = firstStatus;
    }

    delay(POLL_INTERVAL_MS);
  }

  return sawUnstableRead ? READ_STATUS_UNSTABLE : lastError;
}

int8_t confirmSameRom(const uint8_t expected[8], uint32_t timeoutMs) {
  uint8_t actual[8];
  const int8_t status = waitForStableRead(actual, timeoutMs);
  if (status < 1) return status;
  return iButtonTag::equalCode(actual, expected) ? 1 : CONFIRM_STATUS_DIFFERENT;
}

// Returns 1 after two matching reads of the expected ROM, -2 when a different
// valid ROM is observed, -1 after invalid reads, or 0 when no tag is detected.
int8_t verifyWrittenRom(const uint8_t expected[8], uint32_t timeoutMs) {
  const uint32_t startedAt = millis();
  bool sawValidDifferentRom = false;
  bool sawInvalidRom = false;

  while (millis() - startedAt < timeoutMs) {
    uint8_t first[8];
    const int8_t firstStatus = iButton.readCode(first);
    if (firstStatus > 0) {
      if (!iButtonTag::equalCode(first, expected)) {
        sawValidDifferentRom = true;
        delay(POLL_INTERVAL_MS);
        continue;
      }

      delay(STABLE_READ_GAP_MS);
      uint8_t second[8];
      const int8_t secondStatus = iButton.readCode(second);
      if (secondStatus > 0 && iButtonTag::equalCode(second, expected)) return 1;
      if (secondStatus > 0) sawValidDifferentRom = true;
      else if (secondStatus < 0) sawInvalidRom = true;
    } else if (firstStatus < 0) {
      sawInvalidRom = true;
    }

    delay(POLL_INTERVAL_MS);
  }

  if (sawValidDifferentRom) return -2;
  if (sawInvalidRom) return -1;
  return 0;
}

int8_t hexNibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  value = static_cast<char>(toupper(static_cast<unsigned char>(value)));
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
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

  rom[0] = SUPPORTED_FAMILY_CODE;
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
  const int8_t status = waitForStableRead(rom, TOUCH_TIMEOUT_MS);
  setLed(false);

  if (status < 1) {
    printReadFailure(status);
    return;
  }
  if (!isSupportedFamily(rom)) {
    Serial.println(F("ERROR UNSUPPORTED_FAMILY"));
    return;
  }

  Serial.print(F("OK READ "));
  printSerial(rom);
  Serial.println();
}

void handleDetect() {
  uint8_t originalRom[8];
  setLed(true);

  const int8_t readStatus = waitForStableRead(originalRom, TOUCH_TIMEOUT_MS);
  if (readStatus < 1) {
    setLed(false);
    printReadFailure(readStatus);
    return;
  }
  if (!isSupportedFamily(originalRom)) {
    setLed(false);
    Serial.println(F("ERROR UNSUPPORTED_FAMILY"));
    return;
  }

  // Detection can touch writable-tag control flags. Run it exactly once and
  // only after two equal, CRC-valid reads of a supported family.
  const int8_t type = iButton.detectWritableType();
  if (!isSupportedWritableType(type)) {
    setLed(false);
    if (type < 0) Serial.println(F("ERROR BUTTON_REMOVED"));
    else if (type > 0) Serial.println(F("ERROR UNSUPPORTED_TYPE"));
    else Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
    return;
  }

  const int8_t confirmStatus = confirmSameRom(originalRom, PREWRITE_CONFIRM_TIMEOUT_MS);
  setLed(false);

  if (confirmStatus == CONFIRM_STATUS_DIFFERENT) {
    Serial.println(F("ERROR BUTTON_CHANGED"));
  } else if (confirmStatus == READ_STATUS_UNSTABLE) {
    Serial.println(F("ERROR UNSTABLE_CONTACT"));
  } else if (confirmStatus < 1) {
    Serial.println(F("ERROR BUTTON_REMOVED"));
  } else {
    Serial.print(F("OK DETECT TYPE="));
    Serial.println(typeName(type));
  }
}

void handleWrite(const char *argument) {
  uint8_t targetRom[8];
  if (!parseSerial(argument, targetRom)) {
    Serial.println(F("ERROR INVALID_SERIAL"));
    return;
  }

  setLed(true);

  // Preflight is read-only. Two equal, CRC-valid reads are required before any
  // writable-tag command is sent.
  uint8_t originalRom[8];
  const int8_t readStatus = waitForStableRead(originalRom, TOUCH_TIMEOUT_MS);
  if (readStatus < 1) {
    setLed(false);
    printReadFailure(readStatus);
    return;
  }
  if (!isSupportedFamily(originalRom)) {
    setLed(false);
    Serial.println(F("ERROR UNSUPPORTED_FAMILY"));
    return;
  }

  // Avoid entering write mode when the requested serial already matches.
  if (iButtonTag::equalCode(originalRom, targetRom)) {
    setLed(false);
    Serial.println(F("OK WRITE STATUS=UNCHANGED"));
    return;
  }

  // Detect one writable type once. Only the two RW1990 families are allowed.
  const int8_t type = iButton.detectWritableType();
  if (!isSupportedWritableType(type)) {
    setLed(false);
    if (type < 0) Serial.println(F("ERROR BUTTON_REMOVED_BEFORE_WRITE"));
    else if (type > 0) Serial.println(F("ERROR UNSUPPORTED_TYPE"));
    else Serial.println(F("ERROR NOT_WRITABLE_OR_UNSUPPORTED"));
    return;
  }

  // Require two equal reads after detection. Any unstable contact or tag swap
  // aborts the operation before programming begins.
  const int8_t confirmStatus = confirmSameRom(originalRom, PREWRITE_CONFIRM_TIMEOUT_MS);
  if (confirmStatus < 1) {
    setLed(false);
    if (confirmStatus == CONFIRM_STATUS_DIFFERENT) {
      Serial.println(F("ERROR BUTTON_CHANGED"));
    } else if (confirmStatus == READ_STATUS_UNSTABLE) {
      Serial.println(F("ERROR UNSTABLE_CONTACT_BEFORE_WRITE"));
    } else {
      Serial.println(F("ERROR BUTTON_REMOVED_BEFORE_WRITE"));
    }
    return;
  }

  // Type is already known and target ROM is valid. check=false prevents a
  // second detection cycle, so exactly one programming algorithm runs once.
  const int8_t writeStatus = iButton.writeCode(targetRom, type, false);
  if (writeStatus < 1) {
    setLed(false);
    Serial.println(writeStatus == 0 ? F("ERROR WRITE_INTERRUPTED") : F("ERROR WRITE_FAILED"));
    return;
  }

  delay(VERIFY_DELAY_MS);
  const int8_t verifyStatus = verifyWrittenRom(targetRom, VERIFY_TIMEOUT_MS);
  setLed(false);

  if (verifyStatus == 1) {
    Serial.print(F("OK WRITE TYPE="));
    Serial.println(typeName(type));
  } else if (verifyStatus == -2) {
    Serial.println(F("ERROR VERIFY_FAILED"));
  } else {
    Serial.println(F("ERROR VERIFY_READ_FAILED"));
  }
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
  pinMode(IBUTTON_PIN, INPUT);
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
