const matchSelect = document.querySelector("#match-select");
const notice = document.querySelector("#notice");
const eventList = document.querySelector("#event-list");
const etags = new Map();
let selectedMatchId = "";
let pollIntervalMs = 2000;

const lifecycleButtons = [
  ["#start-button", "start", ["SCHEDULED"]],
  ["#pause-button", "pause", ["LIVE"]],
  ["#resume-button", "resume", ["PAUSED"]],
  ["#end-button", "end", ["LIVE", "PAUSED"]],
];

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.error || message;
      if (body.details?.length) message += ` ${body.details.map((detail) => detail.message).join(" ")}`;
    } catch {
      // Keep the HTTP status message if an error response has no JSON body.
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function setConnection(message, isError = false) {
  const indicator = document.querySelector("#connection-state");
  indicator.textContent = message;
  indicator.classList.toggle("error", isError);
}

function updateMatchOptions(matches, selectedId = selectedMatchId) {
  matchSelect.replaceChildren();
  if (!matches.length) {
    matchSelect.add(new Option("No fixtures yet — create one below", ""));
    selectedMatchId = "";
    return;
  }
  for (const match of matches) {
    const option = new Option(
      `${match.homeTeam.name} vs ${match.awayTeam.name} · ${match.status.toLowerCase()}`,
      match.id,
    );
    matchSelect.add(option);
  }
  if (matches.some((match) => match.id === selectedId)) {
    matchSelect.value = selectedId;
  } else {
    matchSelect.selectedIndex = 0;
  }
  selectedMatchId = matchSelect.value;
}

function formatMinute(event) {
  if (!event.minute) return "";
  return `${event.minute}${event.addedMinute ? `+${event.addedMinute}` : ""}′`;
}

function renderEvents(events, state) {
  document.querySelector("#event-count").textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
  eventList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "The whistle hasn’t blown yet. Match events will appear here.";
    eventList.append(empty);
    return;
  }
  const undoneIds = new Set(events.filter((event) => event.type === "GOAL_UNDONE").map((event) => event.relatedEventId));
  for (const event of [...events].reverse()) {
    const item = document.createElement("li");
    item.className = `event-item${undoneIds.has(event.id) ? " event-undone" : ""}`;
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatMinute(event) || `#${event.sequence}`;
    const detail = document.createElement("span");
    detail.className = "event-detail";
    detail.textContent = describeEvent(event, state);
    const marker = document.createElement("span");
    marker.className = "event-marker";
    marker.textContent = event.type === "GOAL" ? "⚽" : event.type === "GOAL_UNDONE" ? "↶" : "·";
    item.append(time, marker, detail);
    eventList.append(item);
  }
}

function describeEvent(event, state) {
  const teamName = event.team?.name
    || (event.teamId === state.homeTeam.id ? state.homeTeam.name : state.awayTeam.name);
  switch (event.type) {
    case "GOAL":
      return `GOAL${event.playerName ? ` · ${event.playerName}` : ""} · ${teamName}`;
    case "GOAL_UNDONE":
      return `Goal overturned · ${teamName}`;
    case "MATCH_STARTED":
      return "Kick-off";
    case "MATCH_PAUSED":
      return "Match paused";
    case "MATCH_RESUMED":
      return "Match resumed";
    case "MATCH_ENDED":
      return "Full time";
    default:
      return event.type;
  }
}

function renderState(state) {
  document.querySelector("#home-name").textContent = state.homeTeam.name;
  document.querySelector("#away-name").textContent = state.awayTeam.name;
  document.querySelector("#home-score").textContent = state.homeScore;
  document.querySelector("#away-score").textContent = state.awayScore;
  const status = document.querySelector("#match-status");
  status.textContent = state.status;
  status.className = `status-badge status-${state.status.toLowerCase()}`;
  document.querySelector("#match-result").textContent = state.winner
    ? `${state.winner === "home" ? state.homeTeam.name : state.awayTeam.name} win`
    : state.status === "ENDED" ? "Draw" : "";
  for (const [selector, _action, allowedStatuses] of lifecycleButtons) {
    document.querySelector(selector).disabled = !allowedStatuses.includes(state.status);
  }
  document.querySelector("#goal-form button").disabled = state.status !== "LIVE";
  document.querySelector("#undo-button").disabled = state.status !== "LIVE" || state.goals.length === 0;
}

async function pollSelectedMatch() {
  if (!selectedMatchId) return;
  try {
    const headers = {};
    if (etags.has(selectedMatchId)) headers["If-None-Match"] = etags.get(selectedMatchId);
    const response = await fetch(`/api/matches/${encodeURIComponent(selectedMatchId)}/live`, { headers });
    if (response.status === 304) {
      setConnection("Up to date");
      return;
    }
    if (!response.ok) throw new Error(`Could not load match (${response.status}).`);
    const state = await response.json();
    const etag = response.headers.get("ETag");
    if (etag) etags.set(selectedMatchId, etag);
    renderState(state);
    const events = await request(`/api/matches/${encodeURIComponent(selectedMatchId)}/events`);
    renderEvents(events, state);
    setConnection(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setConnection("Connection issue", true);
    showNotice(error.message, true);
  }
}

async function refreshFixtures(keepSelection = true) {
  const previous = keepSelection ? selectedMatchId : "";
  const matches = await request("/api/matches");
  updateMatchOptions(matches, previous);
  if (selectedMatchId) await pollSelectedMatch();
}

async function mutateMatch(action, payload) {
  if (!selectedMatchId) throw new Error("Create or select a fixture first.");
  const response = await fetch(`/api/matches/${encodeURIComponent(selectedMatchId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.error || message;
      if (body.details?.length) message += ` ${body.details.map((detail) => detail.message).join(" ")}`;
    } catch {
      // Keep the HTTP status message if an error response has no JSON body.
    }
    throw new Error(message);
  }
  const state = await response.json();
  etags.delete(selectedMatchId);
  renderState(state);
  await pollSelectedMatch();
}

document.querySelector("#create-match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const match = await request("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeTeam: form.get("homeTeam"), awayTeam: form.get("awayTeam") }),
    });
    selectedMatchId = match.id;
    await refreshFixtures();
    event.currentTarget.reset();
    showNotice("Fixture created. Start the match when you’re ready.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

for (const [selector, action] of lifecycleButtons) {
  document.querySelector(selector).addEventListener("click", async () => {
    try {
      await mutateMatch(action);
      showNotice(`Match ${action === "start" ? "started" : `${action}d`}.`);
    } catch (error) {
      showNotice(error.message, true);
    }
  });
}

document.querySelector("#goal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await mutateMatch("goals", {
      team: form.get("team"),
      playerName: form.get("playerName"),
      minute: Number(form.get("minute")),
      addedMinute: Number(form.get("addedMinute") || 0),
    });
    showNotice("Goal recorded.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelector("#undo-button").addEventListener("click", async () => {
  try {
    await mutateMatch("undo");
    showNotice("Latest goal undone and recorded in the audit log.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

matchSelect.addEventListener("change", () => {
  selectedMatchId = matchSelect.value;
  if (selectedMatchId) {
    pollSelectedMatch();
  } else {
    document.querySelector("#match-status").textContent = "No match selected";
  }
});

async function init() {
  try {
    const config = await request("/api/config");
    pollIntervalMs = config.pollIntervalMs;
    await refreshFixtures(false);
    setInterval(pollSelectedMatch, pollIntervalMs);
  } catch (error) {
    setConnection("Server unavailable", true);
    showNotice(error.message, true);
  }
}

init();
