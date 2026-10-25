require("dotenv").config();

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { Prisma, PrismaClient } = require("@prisma/client");
const { z } = require("zod");
const { EVENT_TYPES, ScoringError, assertTransition, deriveMatchState } = require("./scoring");

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 3000);
const configuredPollInterval = Number(process.env.POLL_INTERVAL_MS || 2000);
if (!Number.isFinite(configuredPollInterval) || configuredPollInterval <= 0) {
  throw new Error("POLL_INTERVAL_MS must be a positive number.");
}
const pollIntervalMs = Math.max(1000, configuredPollInterval);

app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const createMatchSchema = z.object({
  homeTeam: z.string().trim().min(1).max(80),
  awayTeam: z.string().trim().min(1).max(80),
}).refine((data) => data.homeTeam.toLowerCase() !== data.awayTeam.toLowerCase(), {
  message: "Home and away teams must be different.",
  path: ["awayTeam"],
});
const goalSchema = z.object({
  team: z.enum(["home", "away"]),
  playerName: z.string().trim().max(80).optional(),
  minute: z.number().int().min(1).max(120),
  addedMinute: z.number().int().min(0).max(30).default(0),
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/config", (_req, res) => res.json({ pollIntervalMs }));

async function loadMatch(matchId, tx = prisma) {
  const match = await tx.footballMatch.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!match) throw new ScoringError("Match not found.", 404);
  return match;
}

async function loadLiveState(match) {
  const events = await prisma.scoringEvent.findMany({
    where: { matchId: match.id },
    orderBy: { sequence: "asc" },
  });
  return {
    ...deriveMatchState(match, events),
    homeTeam: { id: match.homeTeam.id, name: match.homeTeam.name },
    awayTeam: { id: match.awayTeam.id, name: match.awayTeam.name },
    updatedAt: match.updatedAt,
  };
}

app.post("/api/matches", asyncHandler(async (req, res) => {
  const input = createMatchSchema.parse(req.body);
  const match = await prisma.footballMatch.create({
    data: {
      homeTeam: { create: { name: input.homeTeam } },
      awayTeam: { create: { name: input.awayTeam } },
    },
    include: { homeTeam: true, awayTeam: true },
  });
  res.status(201).json(await loadLiveState(match));
}));

app.get("/api/matches", asyncHandler(async (_req, res) => {
  const matches = await prisma.footballMatch.findMany({
    include: { homeTeam: true, awayTeam: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const results = await Promise.all(matches.map(loadLiveState));
  res.json(results);
}));

app.get("/api/matches/:id/live", asyncHandler(async (req, res) => {
  const match = await loadMatch(req.params.id);
  const etag = `W/"${match.id}-${match.version}"`;
  const ifNoneMatch = req.get("if-none-match");
  if (ifNoneMatch === "*" || ifNoneMatch?.split(",").map((value) => value.trim()).includes(etag)) {
    return res.status(304).end();
  }
  res.set("ETag", etag);
  res.json(await loadLiveState(match));
}));

app.get("/api/matches/:id/events", asyncHandler(async (req, res) => {
  const match = await loadMatch(req.params.id);
  const events = await prisma.scoringEvent.findMany({
    where: { matchId: match.id },
    include: { team: { select: { name: true } } },
    orderBy: { sequence: "asc" },
  });
  res.json(events);
}));

app.post("/api/matches/:id/start", asyncHandler((req, res) => recordLifecycle(req, res, EVENT_TYPES.started, "LIVE")));
app.post("/api/matches/:id/pause", asyncHandler((req, res) => recordLifecycle(req, res, EVENT_TYPES.paused, "PAUSED")));
app.post("/api/matches/:id/resume", asyncHandler((req, res) => recordLifecycle(req, res, EVENT_TYPES.resumed, "LIVE")));
app.post("/api/matches/:id/end", asyncHandler((req, res) => recordLifecycle(req, res, EVENT_TYPES.ended, "ENDED")));

async function recordLifecycle(req, res, eventType, nextStatus) {
  const matchId = req.params.id;
  await prisma.$transaction(async (tx) => {
    const match = await loadMatch(matchId, tx);
    assertTransition(match.status, eventType);
    await appendEvent(tx, match, { type: eventType, status: nextStatus });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(await responseForMatch(matchId));
}

app.post("/api/matches/:id/goals", asyncHandler(async (req, res) => {
  const input = goalSchema.parse(req.body);
  const matchId = req.params.id;
  await prisma.$transaction(async (tx) => {
    const match = await loadMatch(matchId, tx);
    assertTransition(match.status, EVENT_TYPES.goal);
    const teamId = input.team === "home" ? match.homeTeamId : match.awayTeamId;
    const homeScore = match.homeScore + (input.team === "home" ? 1 : 0);
    const awayScore = match.awayScore + (input.team === "away" ? 1 : 0);
    await appendEvent(tx, match, {
      type: EVENT_TYPES.goal,
      teamId,
      playerName: input.playerName || null,
      minute: input.minute,
      addedMinute: input.addedMinute,
      homeScore,
      awayScore,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(await responseForMatch(matchId));
}));

app.post("/api/matches/:id/undo", asyncHandler(async (req, res) => {
  const matchId = req.params.id;
  await prisma.$transaction(async (tx) => {
    const match = await loadMatch(matchId, tx);
    assertTransition(match.status, EVENT_TYPES.goalUndone);
    const [goals, undoEvents] = await Promise.all([
      tx.scoringEvent.findMany({ where: { matchId, type: EVENT_TYPES.goal }, orderBy: { sequence: "desc" } }),
      tx.scoringEvent.findMany({ where: { matchId, type: EVENT_TYPES.goalUndone }, select: { relatedEventId: true } }),
    ]);
    const undoneIds = new Set(undoEvents.map((event) => event.relatedEventId));
    const goal = goals.find((event) => !undoneIds.has(event.id));
    if (!goal) throw new ScoringError("There is no goal to undo.", 409);
    await appendEvent(tx, match, {
      type: EVENT_TYPES.goalUndone,
      teamId: goal.teamId,
      relatedEventId: goal.id,
      homeScore: match.homeScore - (goal.teamId === match.homeTeamId ? 1 : 0),
      awayScore: match.awayScore - (goal.teamId === match.awayTeamId ? 1 : 0),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(await responseForMatch(matchId));
}));

async function appendEvent(tx, match, event) {
  const nextVersion = match.version + 1;
  const changed = await tx.footballMatch.updateMany({
    where: { id: match.id, version: match.version },
    data: {
      version: nextVersion,
      ...(event.status ? { status: event.status } : {}),
      ...(event.homeScore !== undefined ? { homeScore: event.homeScore } : {}),
      ...(event.awayScore !== undefined ? { awayScore: event.awayScore } : {}),
    },
  });
  if (changed.count !== 1) throw new ScoringError("Match changed during this update. Refresh and try again.", 409);
  await tx.scoringEvent.create({
    data: {
      matchId: match.id,
      sequence: nextVersion,
      type: event.type,
      teamId: event.teamId,
      playerName: event.playerName,
      minute: event.minute,
      addedMinute: event.addedMinute,
      relatedEventId: event.relatedEventId,
    },
  });
}

async function responseForMatch(matchId) {
  return loadLiveState(await loadMatch(matchId));
}

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid request.", details: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })) });
  }
  if (error.status === 413) return res.status(413).json({ error: "Request body is too large." });
  if (error instanceof ScoringError) return res.status(error.statusCode).json({ error: error.message });
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
    return res.status(409).json({ error: "Conflicting update. Refresh the match and try again." });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Request failed:", error);
  res.status(500).json({ error: "Internal server error." });
});

if (require.main === module) {
  const server = app.listen(port, () => console.log(`Football scoring server listening on port ${port}`));
  const shutdown = async () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { app, prisma };
