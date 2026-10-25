const test = require("node:test");
const assert = require("node:assert/strict");
const { EVENT_TYPES, ScoringError, assertTransition, deriveMatchState } = require("../src/scoring");

const match = { id: "match-1", homeTeamId: "home", awayTeamId: "away", version: 7 };

test("replays goals and undone goals into the current score", () => {
  const events = [
    { id: "start", sequence: 1, type: EVENT_TYPES.started },
    { id: "goal-home", sequence: 2, type: EVENT_TYPES.goal, teamId: "home", minute: 12 },
    { id: "goal-away", sequence: 3, type: EVENT_TYPES.goal, teamId: "away", minute: 45, addedMinute: 2 },
    { id: "undo", sequence: 4, type: EVENT_TYPES.goalUndone, relatedEventId: "goal-home" },
    { id: "end", sequence: 5, type: EVENT_TYPES.ended },
  ];

  assert.deepEqual(deriveMatchState(match, events), {
    id: "match-1",
    status: "ENDED",
    homeScore: 0,
    awayScore: 1,
    version: 7,
    winner: "away",
    goals: [{
      id: "goal-away",
      sequence: 3,
      teamId: "away",
      playerName: undefined,
      minute: 45,
      addedMinute: 2,
      createdAt: undefined,
    }],
  });
});

test("an ended level match is a draw", () => {
  const events = [
    { id: "start", sequence: 1, type: EVENT_TYPES.started },
    { id: "goal-home", sequence: 2, type: EVENT_TYPES.goal, teamId: "home" },
    { id: "goal-away", sequence: 3, type: EVENT_TYPES.goal, teamId: "away" },
    { id: "end", sequence: 4, type: EVENT_TYPES.ended },
  ];

  const state = deriveMatchState(match, events);
  assert.equal(state.status, "ENDED");
  assert.equal(state.homeScore, state.awayScore);
  assert.equal(state.winner, null);
});

test("rejects scoring and invalid lifecycle transitions", () => {
  assert.throws(
    () => assertTransition("PAUSED", EVENT_TYPES.goal),
    (error) => error instanceof ScoringError && error.statusCode === 409,
  );
  assert.throws(
    () => assertTransition("ENDED", EVENT_TYPES.resumed),
    (error) => error instanceof ScoringError && error.statusCode === 409,
  );
  assert.doesNotThrow(() => assertTransition("LIVE", EVENT_TYPES.goal));
});
