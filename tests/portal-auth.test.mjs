import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test, { after, before } from "node:test";

let mockPortal;
let appProcess;
let appBaseUrl;

before(async () => {
  mockPortal = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/api/portal/access/exchange") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.ticket !== "test_ticket_123456789012345678901234") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: -1, message: "ticket invalid" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      code: 0,
      data: {
        appId: "qinbaobei",
        user: { id: 7, displayName: "微信测试用户" },
      },
    }));
  });
  mockPortal.listen(0, "127.0.0.1");
  await once(mockPortal, "listening");
  const mockAddress = mockPortal.address();

  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const appPort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));

  appBaseUrl = `http://127.0.0.1:${appPort}`;
  appProcess = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(appPort)],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        PORTAL_API_BASE: `http://127.0.0.1:${mockAddress.port}/api/portal`,
        PORTAL_SESSION_SECRET: "test-only-session-secret-with-at-least-32-characters",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(appBaseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Next.js test server did not start");
});

after(async () => {
  if (appProcess && !appProcess.killed) appProcess.kill();
  if (mockPortal) await new Promise(resolve => mockPortal.close(resolve));
});

test("requires a portal session for protected APIs", async () => {
  const response = await fetch(`${appBaseUrl}/api/baidu/status`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "portal_login_required",
    message: "请从微信小程序重新获取访问链接。",
  });
});

test("exchanges a portal ticket for a signed HttpOnly session", async () => {
  const exchange = await fetch(`${appBaseUrl}/api/portal/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: "test_ticket_123456789012345678901234" }),
  });
  assert.equal(exchange.status, 200);

  const setCookie = exchange.headers.get("set-cookie");
  assert.match(setCookie ?? "", /^qinbaobei_portal_session=/);
  assert.match(setCookie ?? "", /HttpOnly/i);
  assert.match(setCookie ?? "", /Secure/i);
  assert.match(setCookie ?? "", /SameSite=Lax/i);
  assert.doesNotMatch(setCookie ?? "", /test_ticket/);

  const cookie = setCookie.split(";", 1)[0];
  const session = await fetch(`${appBaseUrl}/api/portal/session`, {
    headers: { cookie },
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authenticated: true,
    user: { id: 7, displayName: "微信测试用户" },
  });

  const protectedApi = await fetch(`${appBaseUrl}/api/baidu/status`, {
    headers: { cookie },
  });
  assert.equal(protectedApi.status, 200);

  const logout = await fetch(`${appBaseUrl}/api/portal/session`, {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/i);
});

