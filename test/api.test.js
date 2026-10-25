const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { app, prisma } = require("../src/server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
});

test("returns polling configuration", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pollIntervalMs >= 1000, true);
});

test("handles async route validation errors without terminating the server", async () => {
  const response = await fetch(`${baseUrl}/api/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ homeTeam: "Same", awayTeam: " same " }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid request.");

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
});

test("rejects invalid goal input before attempting database access", async () => {
  const response = await fetch(`${baseUrl}/api/matches/missing/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team: "home", minute: 0 }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid request.");
});
