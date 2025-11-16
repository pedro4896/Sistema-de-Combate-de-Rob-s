#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <FastLED.h>
#include <ArduinoJson.h>

// ⭐️ AUMENTADO: 512 bytes deve ser mais seguro para o JSON recebido.
const size_t WS_RX_DOC_SIZE = 512;

// ========= REDE / BACKEND =========
const char *ssid = "DIGITAL-ARTHUR";
const char *password = "valdeci102";
const char *arena_host = "192.168.1.112";
const int arena_port = 8080;
const char *websocket_path = "/";

// ========= FITA LED =========
#define LED_PIN 4  // D2 (GPIO4)
#define NUM_LEDS 300
// Note: CRGB leds[300] consome ~900 bytes de RAM.
#define NUM_LEDS_SIDE (NUM_LEDS / 2)
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define BASE_BRIGHTNESS 255  // brilho padrão
#define WHITE_LIMIT 70      // limite de brilho só para o branco (evita queda de tensão)

CRGB leds[NUM_LEDS];

// Cores
const CRGB COLOR_GREEN = CRGB::Green;
const CRGB COLOR_BLUE = CRGB::Blue;
const CRGB COLOR_WHITE = CRGB::White;
const CRGB COLOR_RED = CRGB::Red;
const CRGB COLOR_BLACK = CRGB::Black;

// ========= BOTÕES =========
#define BTN_GREEN_SIDE 14  // D5 (GPIO14)
#define BTN_BLUE_SIDE 12   // D6 (GPIO12)

struct Button {
  uint8_t pin;
  bool lastStable;
  unsigned long lastChangeMs;
};
const unsigned long DEBOUNCE_MS = 50;
Button btnGreen{ BTN_GREEN_SIDE, HIGH, 0 };
Button btnBlue{ BTN_BLUE_SIDE, HIGH, 0 };

// ========= ESTADO / RENDER =========
WebSocketsClient webSocket;

enum Mode { MODE_IDLE,
            MODE_FIGHT_RUNNING,
            MODE_FIGHT_PAUSED,
            MODE_RECOVERY,
            MODE_ENDED };

struct {
  Mode mode = MODE_IDLE;
  bool greenOn = true;  // metade esquerda
  bool blueOn = true;   // metade direita
} S;

bool renderDirty = true;  // força primeira renderização

// Função de diagnóstico de memória (Adicionada)
void printMemoryInfo() {
  // A memória livre é um indicador chave de problemas de NoMemory
  Serial.print(F("[INFO] Heap Livre (RAM): "));
  Serial.print(ESP.getFreeHeap());
  Serial.println(F(" bytes"));

  // Para FastLED em ESP8266, a RAM do ICACHE pode ser importante
  Serial.print(F("[INFO] RAM ICACHE Livre: "));
  Serial.print(ESP.getFreeContStack());
  Serial.println(F(" bytes"));
}

inline void render() {
  // 1) Zera o buffer (evita QUALQUER resíduo/soma de estados)
  FastLED.clear(false);  // só zera o buffer, sem dar show

  // 2) Desenha SOMENTE o que deve estar aceso neste frame
  switch (S.mode) {
    case MODE_IDLE:
      {
        if (S.greenOn) {
          fill_solid(leds, NUM_LEDS_SIDE, COLOR_GREEN);
        }
        if (S.blueOn) {
          fill_solid(leds + NUM_LEDS_SIDE, NUM_LEDS_SIDE, COLOR_BLUE);
        }
        break;
      }

    case MODE_FIGHT_RUNNING:
      {
        // Branco total com limite provisório de brilho para proteger a fonte
        uint8_t prev = FastLED.getBrightness();
        FastLED.setBrightness(min<uint8_t>(prev, WHITE_LIMIT));
        fill_solid(leds, NUM_LEDS, COLOR_WHITE);
        FastLED.show();
        FastLED.setBrightness(prev);
        renderDirty = false;
        yield();
        return;  // já exibiu
      }

    case MODE_FIGHT_PAUSED:
    case MODE_RECOVERY:
    case MODE_ENDED:
      {
        // Vermelho sólido (evita usar branco em 300 LEDs)
        fill_solid(leds, NUM_LEDS, COLOR_RED);
        break;
      }
  }

  // 3) Exibe de uma vez (um único frame)
  FastLED.show();
  renderDirty = false;
  yield();
}

// ========= APLICAÇÃO DE COMANDOS =========
void applyLEDCommand(const String &cmd) {
  if (cmd == "STATE_IDLE_NORMAL") {
    S.mode = MODE_IDLE;
    S.greenOn = true;
    S.blueOn = true;

  } else if (cmd == "STATE_IDLE_GREEN_OFF") {
    S.mode = MODE_IDLE;
    S.greenOn = false;
    S.blueOn = true;

  } else if (cmd == "STATE_IDLE_BLUE_OFF") {
    S.mode = MODE_IDLE;
    S.greenOn = true;
    S.blueOn = false;

  } else if (cmd == "STATE_OFF") {
    S.mode = MODE_IDLE;
    S.greenOn = false;
    S.blueOn = false;

  } else if (cmd == "STATE_FIGHT_RUNNING") {
    S.mode = MODE_FIGHT_RUNNING;

  } else if (cmd == "STATE_FIGHT_PAUSED") {
    S.mode = MODE_FIGHT_PAUSED;

  } else if (cmd == "STATE_RECOVERY_ACTIVE") {
    S.mode = MODE_RECOVERY;

  } else if (cmd == "STATE_FIGHT_ENDED") {
    S.mode = MODE_ENDED;

  } else {
    // fallback seguro
    S.mode = MODE_IDLE;
    S.greenOn = true;
    S.blueOn = true;
  }

  renderDirty = true;  // marca para redesenhar em um único frame
}

// ========= ENVIO JSON (TOGGLE) =========
void sendLightToggle(const char *side) {
  // Buffer de envio também usa alocação estática (128 bytes)
  StaticJsonDocument<128> doc;
  doc["type"] = "LIGHT_TOGGLE";
  if (side && side[0] != '\0') doc["payload"]["side"] = side;  // "GREEN" | "BLUE" | "NORMAL"
  char buf[128];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  webSocket.sendTXT(buf, n);
}

// ========= BOTÕES (DEBOUNCE REAL) =========
void pollButton(Button &btn, const char *side) {
  bool reading = digitalRead(btn.pin);
  unsigned long now = millis();

  if (reading != btn.lastStable && (now - btn.lastChangeMs) >= DEBOUNCE_MS) {
    btn.lastStable = reading;
    btn.lastChangeMs = now;

    if (reading == LOW) {     // INPUT_PULLUP: LOW = pressionado
      sendLightToggle(side);  // backend decide e devolve LED_COMMAND final
    }
  }
}

void checkButtons() {
  pollButton(btnGreen, "GREEN");
  pollButton(btnBlue, "BLUE");
}

// ========= WEBSOCKET (MODIFICADO) =========
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  printMemoryInfo();  // Adicionado para depurar o uso de RAM

  switch (type) {
    case WStype_CONNECTED:
      Serial.println(F("[WS] Conectado"));
      sendLightToggle("NORMAL");  // sincroniza estado
      break;

    case WStype_DISCONNECTED:
      Serial.println(F("[WS] Desconectado"));
      S.mode = MODE_IDLE;
      S.greenOn = false;
      S.blueOn = false;
      renderDirty = true;
      break;

    case WStype_TEXT:
      {
        Serial.print(F("[JSON] Recebendo "));
        Serial.print(length);
        Serial.println(F(" bytes."));

        // ⭐️ CORREÇÃO DO ERRO NOMEMORY: Buffer aumentado para 512 bytes
        StaticJsonDocument<WS_RX_DOC_SIZE> doc;

        DeserializationError err = deserializeJson(doc, payload, length);

        if (err) {
          Serial.print(F("[JSON] Erro de desserialização: "));
          Serial.println(err.f_str());
          // Se o erro for NoMemory AGORA, a mensagem JSON é MAIOR que 512 bytes!
          // Verifique a saída serial para o tamanho real recebido.
          return;
        }

        // Acesso aos campos (usando const char* para otimização)
        const char *msgType = doc["type"] | "";

        if (strcmp(msgType, "LED_COMMAND") == 0) {
          String command = doc["payload"]["command"] | "";
          if (command.length() > 0) applyLEDCommand(command);
        }
        break;
      }

    default:
      break;
  }
}

// ========= SETUP / LOOP =========
void setup() {
  Serial.begin(115200);
  delay(100);

  // LEDs
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(BASE_BRIGHTNESS);
  FastLED.setDither(0);  // opcional para depuração (sem dithering)

  // Botões
  pinMode(BTN_GREEN_SIDE, INPUT_PULLUP);
  pinMode(BTN_BLUE_SIDE, INPUT_PULLUP);

  // Wi-Fi
  Serial.print(F("Conectando a WiFi..."));
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(F("."));
    yield();
  }
  Serial.println(F("\n✅ WiFi Conectado"));
  Serial.print(F("IP do ESP: "));
  Serial.println(WiFi.localIP());

  printMemoryInfo();  // Mostra a memória após a inicialização pesada (FastLED/WiFi)

  // WS (puro; para WSS usar beginSSL)
  webSocket.begin(arena_host, arena_port, websocket_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  renderDirty = true;  // força primeiro frame
}

void loop() {
  webSocket.loop();
  checkButtons();

  if (renderDirty) render();  // desenha apenas quando o estado mudou
}