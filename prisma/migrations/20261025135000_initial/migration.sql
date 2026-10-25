CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'ENDED');
CREATE TYPE "ScoringEventType" AS ENUM ('MATCH_STARTED', 'MATCH_PAUSED', 'MATCH_RESUMED', 'MATCH_ENDED', 'GOAL', 'GOAL_UNDONE');

CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FootballMatch" (
    "id" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeScore" INTEGER NOT NULL DEFAULT 0,
    "awayScore" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FootballMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScoringEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "ScoringEventType" NOT NULL,
    "teamId" TEXT,
    "playerName" TEXT,
    "minute" INTEGER,
    "addedMinute" INTEGER,
    "relatedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoringEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FootballMatch_status_updatedAt_idx" ON "FootballMatch"("status", "updatedAt");
CREATE UNIQUE INDEX "ScoringEvent_matchId_sequence_key" ON "ScoringEvent"("matchId", "sequence");
CREATE INDEX "ScoringEvent_matchId_createdAt_idx" ON "ScoringEvent"("matchId", "createdAt");
CREATE INDEX "ScoringEvent_relatedEventId_idx" ON "ScoringEvent"("relatedEventId");

ALTER TABLE "FootballMatch" ADD CONSTRAINT "FootballMatch_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FootballMatch" ADD CONSTRAINT "FootballMatch_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoringEvent" ADD CONSTRAINT "ScoringEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoringEvent" ADD CONSTRAINT "ScoringEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoringEvent" ADD CONSTRAINT "ScoringEvent_relatedEventId_fkey" FOREIGN KEY ("relatedEventId") REFERENCES "ScoringEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
