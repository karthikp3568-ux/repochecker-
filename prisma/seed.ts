/** Dev seed: a dev user matching the default dev-login credentials. No rubric criteria are seeded, ever. */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const user = await db.user.upsert({
    where: { email: "dev@repojudge.local" },
    update: {},
    create: { email: "dev@repojudge.local", name: "Dev Judge" },
  });
  console.log(`[seed] dev user ${user.email} (${user.id})`);
}

main()
  .finally(() => db.$disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
