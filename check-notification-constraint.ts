import { prisma } from "./src/config/prisma";

async function main() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT
      conname,
      pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'chk_notifications_type';
  `);

  console.log(result);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
