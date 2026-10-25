const EVENT_TYPES = Object.freeze({
  started: "MATCH_STARTED",
  paused: "MATCH_PAUSED",
  resumed: "MATCH_RESUMED",
  ended: "MATCH_ENDED",
  goal: "GOAL",
  goalUndone: "GOAL_UNDONE",
});

class ScoringError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ScoringError";
    this.statusCode = statusCode;
  }
}

function deriveMatchState(match, events) {
  const orderedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
  const undoneGoalIds = new Set(
    orderedEvents
      .filter((event) => event.type === EVENT_TYPES.goalUndone)
      .map((event) => event.relatedEventId),
  );
  const goals = orderedEvents.filter(
    (event) => event.type === EVENT_TYPES.goal && !undoneGoalIds.has(event.id),
  );
  const homeScore = goals.filter((event) => event.teamId === match.homeTeamId).length;
  const awayScore = goals.filter((event) => event.teamId === match.awayTeamId).length;

  let status = "SCHEDULED";
  for (const event of orderedEvents) {
    if (event.type === EVENT_TYPES.started || event.type === EVENT_TYPES.resumed) status = "LIVE";
    if (event.type === EVENT_TYPES.paused) status = "PAUSED";
    if (event.type === EVENT_TYPES.ended) status = "ENDED";
  }

  return {
    id: match.id,
    status,
    homeScore,
    awayScore,
    version: match.version,
    winner:
      status !== "ENDED" || homeScore === awayScore
        ? null
        : homeScore > awayScore
          ? "home"
          : "away",
    goals: goals.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      teamId: event.teamId,
      playerName: event.playerName,
      minute: event.minute,
      addedMinute: event.addedMinute,
      createdAt: event.createdAt,
    })),
  };
}

function assertTransition(status, eventType) {
  const allowed = {
    [EVENT_TYPES.started]: ["SCHEDULED"],
    [EVENT_TYPES.paused]: ["LIVE"],
    [EVENT_TYPES.resumed]: ["PAUSED"],
    [EVENT_TYPES.ended]: ["LIVE", "PAUSED"],
    [EVENT_TYPES.goal]: ["LIVE"],
    [EVENT_TYPES.goalUndone]: ["LIVE"],
  };
  if (!allowed[eventType]?.includes(status)) {
    const action = {
      [EVENT_TYPES.started]: "start",
      [EVENT_TYPES.paused]: "pause",
      [EVENT_TYPES.resumed]: "resume",
      [EVENT_TYPES.ended]: "end",
      [EVENT_TYPES.goal]: "record a goal in",
      [EVENT_TYPES.goalUndone]: "undo a goal in",
    }[eventType];
    throw new ScoringError(`Cannot ${action} a match while it is ${status.toLowerCase()}.`, 409);
  }
}

module.exports = { EVENT_TYPES, ScoringError, assertTransition, deriveMatchState };
