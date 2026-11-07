import test from "node:test";
import assert from "node:assert/strict";
import { generateReply } from "../lib/gemini.js";

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

test("gives up after three attempts on persistent 503", async () => {
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
  assert.equal(calls, 3);
  assert.deepEqual(delays, [700, 1400]);
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
