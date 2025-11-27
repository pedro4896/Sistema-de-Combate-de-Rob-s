#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <FastLED.h>
#include <ArduinoJson.h>

// ===== JSON BUFFER (DEVE SER MENOR QUE 4096) =====
const size_t WS_RX_DOC_SIZE = 4096;

// ===== WIFI =====
const char *ssid = "teste";
const char *password = "testeesp32";
const char *arena_host = "192.168.137.1";
const int arena_port = 8080;
const char *websocket_path = "/esp";

// ===== LED STRIP =====
#define LED_PIN 4
#define NUM_LEDS 600
#define NUM_LEDS_SIDE (NUM_LEDS / 2)
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define BASE_BRIGHTNESS 170
#define WHITE_LIMIT 25

CRGB leds[NUM_LEDS];

const CRGB COLOR_GREEN = CRGB::Green;
const CRGB COLOR_BLUE  = CRGB::Blue;
const CRGB COLOR_WHITE = CRGB::White;
const CRGB COLOR_RED   = CRGB::Red;

// ===== BUTTONS =====
#define BTN_GREEN_SIDE 14
#define BTN_BLUE_SIDE 12

struct Button {
  uint8_t pin;
  bool lastStable;
  unsigned long lastChangeMs;
};
Button btnGreen{ BTN_GREEN_SIDE, HIGH, 0 };
Button btnBlue{ BTN_BLUE_SIDE, HIGH, 0 };
const unsigned long DEBOUNCE_MS = 50;

// ===== STATE MACHINE =====
WebSocketsClient webSocket;

enum Mode {
  MODE_IDLE,
  MODE_FIGHT_RUNNING,
  MODE_FIGHT_PAUSED,
  MODE_RECOVERY,
  MODE_ENDED
};

struct {
  Mode mode = MODE_IDLE;
  bool greenOn = true;
  bool blueOn = true;
} S;

bool renderDirty = true;

// ===== RENDER =====
void render() {
  FastLED.clear(false);

  switch (S.mode) {

    case MODE_IDLE:
      if (S.greenOn) fill_solid(leds, NUM_LEDS_SIDE, COLOR_GREEN);
      if (S.blueOn)  fill_solid(leds + NUM_LEDS_SIDE, NUM_LEDS_SIDE, COLOR_BLUE);
      break;

    case MODE_FIGHT_RUNNING:
      FastLED.setBrightness(WHITE_LIMIT);
      fill_solid(leds, NUM_LEDS, COLOR_WHITE);
      FastLED.show();
      FastLED.setBrightness(BASE_BRIGHTNESS);
      renderDirty = false;
      return;

    case MODE_FIGHT_PAUSED:
    case MODE_RECOVERY:
    case MODE_ENDED:
      fill_solid(leds, NUM_LEDS, COLOR_RED);
      break;
  }

  FastLED.show();
  renderDirty = false;
}

// ===== COMMAND HANDLER =====
void applyLEDCommand(const String &cmd) {
  if (cmd == "STATE_IDLE_NORMAL") {
    S.mode = MODE_IDLE;
    S.greenOn = true;
    S.blueOn = true;
    Serial.println("STATE_IDLE_NORMAL");
  }

  else if (cmd == "STATE_IDLE_GREEN_OFF") {
    S.mode = MODE_IDLE;
    S.greenOn = false;
    S.blueOn  = true;
    Serial.println("STATE_IDLE_GREEN_OFF");
  }

  else if (cmd == "STATE_IDLE_BLUE_OFF") {
    S.mode = MODE_IDLE;
    S.greenOn = true;
    S.blueOn  = false;
    Serial.println("STATE_IDLE_BLUE_OFF");
  }

  else if (cmd == "STATE_OFF") {
    S.mode = MODE_IDLE;
    S.greenOn = false;
    S.blueOn = false;
    Serial.println("STATE_OFF");
  }

  else if (cmd == "STATE_FIGHT_RUNNING") {
    S.mode = MODE_FIGHT_RUNNING;
    Serial.println("STATE_FIGHT_RUNNING");
  }

  else if (cmd == "STATE_FIGHT_PAUSED") {
    S.mode = MODE_FIGHT_PAUSED;
    Serial.println("STATE_FIGHT_PAUSED");
  }

  else if (cmd == "STATE_RECOVERY_ACTIVE") {
    S.mode = MODE_RECOVERY;
    Serial.println("STATE_RECOVERY_ACTIVE");
  }

  else if (cmd == "STATE_FIGHT_ENDED") {
    S.mode = MODE_ENDED;
    Serial.println("STATE_FIGHT_ENDED");
  }

  renderDirty = true;
}

// ===== BUTTON LOGIC =====
void sendLightToggle(const char *side) {
  StaticJsonDocument<128> doc;
  doc["type"] = "LIGHT_TOGGLE";
  doc["payload"]["side"] = side;

  char buf[128];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  webSocket.sendTXT(buf, n);
}

void pollButton(Button &btn, const char *side) {
  bool reading = digitalRead(btn.pin);
  unsigned long now = millis();

  if (reading != btn.lastStable && (now - btn.lastChangeMs) >= DEBOUNCE_MS) {
    btn.lastStable = reading;
    btn.lastChangeMs = now;

    if (reading == LOW) {
      sendLightToggle(side);
    }
  }
}

void checkButtons() {
  pollButton(btnGreen, "GREEN");
  pollButton(btnBlue, "BLUE");
}

// ===== WEBSOCKET EVENTS =====
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {

  switch (type) {

    case WStype_CONNECTED: {
      Serial.println("[WS] Conectado");

      // === IDENTIFICAÇÃO ===
      StaticJsonDocument<64> doc;
      doc["client"] = "ESP";
      char buf[64];
      size_t n = serializeJson(doc, buf, sizeof(buf));
      webSocket.sendTXT(buf, n);
      break;
    }

    case WStype_DISCONNECTED:
      Serial.println("[WS] Desconectado");
      S.mode = MODE_IDLE;
      S.greenOn = false;
      S.blueOn = false;
      renderDirty = true;
      break;

    case WStype_PING:
      Serial.println("[WS] Ping recebido");
      break;

    case WStype_TEXT: {
      StaticJsonDocument<WS_RX_DOC_SIZE> doc;
      auto err = deserializeJson(doc, payload, length);

      if (err) {
        Serial.println("[JSON] Erro parse");
        return;
      }

      const char *msgType = doc["type"] | "";

      // === IGNORAR UPDATE_STATE (é grande demais) ===
      if (strcmp(msgType, "UPDATE_STATE") == 0) {
        Serial.println("[JSON] UPDATE_STATE ignorado");
        return;
      }

      if (strcmp(msgType, "LED_COMMAND") == 0) {
        String command = doc["payload"]["command"] | "";
        applyLEDCommand(command);
      }

      break;
    }
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);

  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(BASE_BRIGHTNESS);

  pinMode(BTN_GREEN_SIDE, INPUT_PULLUP);
  pinMode(BTN_BLUE_SIDE, INPUT_PULLUP);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
  }

  webSocket.begin(arena_host, arena_port, websocket_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(30000, 5000, 3);
}

// ===== LOOP =====
void loop() {
  webSocket.loop();
  checkButtons();
  if (renderDirty) render();
}
