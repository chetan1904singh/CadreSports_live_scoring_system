const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.footballMatch.findFirst({
    where: { status: { in: ["SCHEDULED", "LIVE", "PAUSED"] } },
  });
  if (existing) {
    console.log(`Seed skipped; active match ${existing.id} already exists.`);
    return;
  }

  const match = await prisma.footballMatch.create({
    data: {
      homeTeam: { create: { name: "Harbor FC" } },
      awayTeam: { create: { name: "Summit United" } },
    },
    include: { homeTeam: true, awayTeam: true },
  });
  console.log(`Created ${match.homeTeam.name} vs ${match.awayTeam.name} (${match.id}).`);
}

main()
  .catch((error) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
