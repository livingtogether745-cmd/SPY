import test from "node:test";
import assert from "node:assert/strict";
import { buildContents, generateJson, generateReply } from "../lib/gemini.js";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    }
  };
}

const OK_BODY = { candidates: [{ content: { parts: [{ text: "Halo" }] } }] };

test("retries a transient 503 and then succeeds", async () => {
  let calls = 0;
  const delays = [];
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? response(503, { error: { status: "UNAVAILABLE" } }) : response(200, OK_BODY);
  };

  const reply = await generateReply("halo", {
    apiKey: "test",
    model: "gemini-3.1-flash-lite",
    fetchImpl,
    sleep: async (ms) => {
      delays.push(ms);
    }
  });

  assert.equal(reply, "Halo");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [700]);
});

test("retries a timeout and then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }
    return response(200, OK_BODY);
  };

  const reply = await generateReply("halo", {
    apiKey: "test",
    model: "gemini-3.1-flash-lite",
    fetchImpl,
    sleep: async () => {}
  });

  assert.equal(reply, "Halo");
  assert.equal(calls, 2);
});

test("does not retry a non-retryable 404", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(404, { error: { status: "NOT_FOUND" } });
  };

  await assert.rejects(
    () =>
      generateReply("halo", {
        apiKey: "test",
        model: "missing-model",
        fetchImpl,
        sleep: async () => {}
      }),
    /Gemini membalas HTTP 404/
  );
  assert.equal(calls, 1);
});

test("gives up after two attempts on persistent 503", async () => {
  let calls = 0;
  const delays = [];
  const fetchImpl = async () => {
    calls += 1;
    return response(503, { error: { status: "UNAVAILABLE" } });
  };

  await assert.rejects(
    () =>
      generateReply("halo", {
        apiKey: "test",
        model: "gemini-3.1-flash-lite",
        fetchImpl,
        sleep: async (ms) => {
          delays.push(ms);
        }
      }),
    /Gemini membalas HTTP 503/
  );
  assert.equal(calls, 2);
  assert.deepEqual(delays, [700]);
});

test("does not retry an empty candidate (safety block)", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(200, { candidates: [{ finishReason: "SAFETY" }] });
  };

  await assert.rejects(
    () =>
      generateReply("halo", {
        apiKey: "test",
        model: "gemini-3.1-flash-lite",
        fetchImpl,
        sleep: async () => {}
      }),
    /Gemini tidak mengembalikan teks \(SAFETY\)/
  );
  assert.equal(calls, 1);
});

test("buildContents sends bounded history and ends with the current message", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "model",
    text: `pesan ${index}`
  }));

  const contents = buildContents(history, "pesan baru");

  assert.ok(contents.length <= 17);
  assert.equal(contents[0].role, "user");
  assert.equal(contents[contents.length - 1].role, "user");
  assert.match(contents[contents.length - 1].parts[0].text, /pesan baru/);
});

test("buildContents drops the oldest turns when the character budget is exceeded", () => {
  const history = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "model",
    text: "x".repeat(2000)
  }));

  const contents = buildContents(history, "halo");
  const total = contents.reduce((sum, entry) => sum + entry.parts[0].text.length, 0);

  assert.ok(total <= 12_000);
  assert.equal(contents[contents.length - 1].role, "user");
  assert.match(contents[contents.length - 1].parts[0].text, /halo/);
});

test("generateReply enables JSON response mode when requested", async () => {
  let body;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return response(200, OK_BODY);
  };

  await generateReply("kembalikan json", {
    apiKey: "test",
    model: "gemini-3.1-flash-lite",
    json: true,
    fetchImpl,
    sleep: async () => {}
  });

  assert.equal(body.generationConfig.responseMimeType, "application/json");
});

test("generateJson parses a fenced JSON reply", async () => {
  const fetchImpl = async () =>
    response(200, {
      candidates: [{ content: { parts: [{ text: '```json\n{"profile":{"nickname":"Raka"}}\n```' }] } }]
    });

  const parsed = await generateJson("extract", {
    apiKey: "test",
    model: "gemini-3.1-flash-lite",
    fetchImpl,
    sleep: async () => {}
  });

  assert.deepEqual(parsed, { profile: { nickname: "Raka" } });
});
