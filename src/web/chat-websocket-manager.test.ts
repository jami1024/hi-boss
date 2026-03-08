import assert from "node:assert/strict";
import test from "node:test";
import {
  getChatSocketState,
  registerChatSocketListener,
  sendChatSocketMessage,
} from "../../web/src/lib/chat-websocket-manager.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

type MockGlobal = {
  WebSocket?: typeof FakeWebSocket;
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };
  window?: {
    location: {
      protocol: string;
      host: string;
    };
  };
};

function withMockBrowserEnv(run: () => void): void {
  const globalAny = globalThis as unknown as MockGlobal;
  const prevWebSocket = globalAny.WebSocket;
  const prevLocalStorage = globalAny.localStorage;
  const prevWindow = globalAny.window;

  const store = new Map<string, string>();
  globalAny.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  globalAny.window = {
    location: {
      protocol: "http:",
      host: "localhost:3000",
    },
  };
  globalAny.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  globalAny.localStorage.setItem("hiboss_token", "boss-token");

  try {
    run();
  } finally {
    globalAny.WebSocket = prevWebSocket;
    globalAny.localStorage = prevLocalStorage;
    globalAny.window = prevWindow;
  }
}

test("chat websocket manager syncs subscribe and unsubscribe on listener changes", () => {
  withMockBrowserEnv(() => {
    const unsubscribeNex = registerChatSocketListener({
      enabled: true,
      subscriptions: ["nex"],
    });

    assert.equal(FakeWebSocket.instances.length, 1);
    const socket = FakeWebSocket.instances[0];
    assert.equal(socket?.url, "ws://localhost:3000/ws/chat");

    socket?.emitOpen();
    socket?.emitMessage({ type: "auth-ok" });

    const unsubscribeKai = registerChatSocketListener({
      enabled: true,
      subscriptions: ["kai"],
    });

    unsubscribeNex();

    const payloads = (socket?.sent ?? []).map((raw) => JSON.parse(raw) as { type: string; agentName?: string });
    const subscriptionOps = payloads.filter((payload) => payload.type === "subscribe" || payload.type === "unsubscribe");

    assert.deepEqual(subscriptionOps, [
      { type: "subscribe", agentName: "nex" },
      { type: "subscribe", agentName: "kai" },
      { type: "unsubscribe", agentName: "nex" },
    ]);

    unsubscribeKai();

    const state = getChatSocketState();
    assert.equal(state.connected, false);
    assert.equal(state.authenticated, false);
    assert.equal(FakeWebSocket.instances.length, 1);
  });
});

test("chat websocket manager does not duplicate shared subscriptions or early unsubscribe", () => {
  withMockBrowserEnv(() => {
    const unsubscribeA = registerChatSocketListener({
      enabled: true,
      subscriptions: ["nex", "nex"],
    });

    assert.equal(FakeWebSocket.instances.length, 1);
    const socket = FakeWebSocket.instances[0];
    socket?.emitOpen();
    socket?.emitMessage({ type: "auth-ok" });

    const unsubscribeB = registerChatSocketListener({
      enabled: true,
      subscriptions: ["nex"],
    });

    unsubscribeA();

    const payloadsAfterFirstUnsubscribe = (socket?.sent ?? []).map((raw) =>
      JSON.parse(raw) as { type: string; agentName?: string }
    );
    const nexOps = payloadsAfterFirstUnsubscribe.filter(
      (payload) =>
        (payload.type === "subscribe" || payload.type === "unsubscribe") && payload.agentName === "nex"
    );
    assert.deepEqual(nexOps, [{ type: "subscribe", agentName: "nex" }]);

    unsubscribeB();

    const payloadsAfterAllUnsubscribe = (socket?.sent ?? []).map((raw) =>
      JSON.parse(raw) as { type: string; agentName?: string }
    );
    const nexOpsFinal = payloadsAfterAllUnsubscribe.filter(
      (payload) =>
        (payload.type === "subscribe" || payload.type === "unsubscribe") && payload.agentName === "nex"
    );
    assert.deepEqual(nexOpsFinal, [{ type: "subscribe", agentName: "nex" }]);

    const state = getChatSocketState();
    assert.equal(state.connected, false);
    assert.equal(state.authenticated, false);
  });
});

test("chat websocket manager only sends chat payload after authentication", () => {
  withMockBrowserEnv(() => {
    const unsubscribe = registerChatSocketListener({
      enabled: true,
      subscriptions: ["nex"],
    });

    assert.equal(FakeWebSocket.instances.length, 1);
    const socket = FakeWebSocket.instances[0];

    sendChatSocketMessage("nex", "before-auth");
    const beforeAuthPayloads = (socket?.sent ?? []).map((raw) =>
      JSON.parse(raw) as { type: string; text?: string; agentName?: string }
    );
    assert.equal(beforeAuthPayloads.some((payload) => payload.type === "send"), false);

    socket?.emitOpen();
    sendChatSocketMessage("nex", "still-before-auth-ok");
    const beforeAuthOkPayloads = (socket?.sent ?? []).map((raw) =>
      JSON.parse(raw) as { type: string; text?: string; agentName?: string }
    );
    assert.equal(beforeAuthOkPayloads.some((payload) => payload.type === "send"), false);

    socket?.emitMessage({ type: "auth-ok" });
    sendChatSocketMessage("nex", "after-auth");

    const sendPayloads = (socket?.sent ?? [])
      .map((raw) => JSON.parse(raw) as { type: string; text?: string; agentName?: string })
      .filter((payload) => payload.type === "send");
    assert.deepEqual(sendPayloads, [
      {
        type: "send",
        agentName: "nex",
        text: "after-auth",
      },
    ]);

    unsubscribe();
  });
});

test("chat websocket manager reports auth-fail and blocks sends", () => {
  withMockBrowserEnv(() => {
    const errors: string[] = [];
    const unsubscribe = registerChatSocketListener({
      enabled: true,
      subscriptions: ["nex"],
      onError: (message) => {
        errors.push(message);
      },
    });

    assert.equal(FakeWebSocket.instances.length, 1);
    const socket = FakeWebSocket.instances[0];

    socket?.emitOpen();
    socket?.emitMessage({ type: "auth-fail", message: "Token expired" });

    sendChatSocketMessage("nex", "should-not-send-after-auth-fail");

    const payloads = (socket?.sent ?? []).map((raw) =>
      JSON.parse(raw) as { type: string; text?: string; agentName?: string }
    );
    const sendPayloads = payloads.filter((payload) => payload.type === "send");

    assert.deepEqual(errors, ["Token expired"]);
    assert.deepEqual(sendPayloads, []);

    const state = getChatSocketState();
    assert.equal(state.connected, true);
    assert.equal(state.authenticated, false);

    unsubscribe();
  });
});
