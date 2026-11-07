// PoC-only database connectivity probe executed from the GitHub runner host.
// Uses Bun 1.3's built-in PostgreSQL adapter so no dependency discovery is needed.
// No customer data, migrations, or production databases.
import { SQL } from "bun";
const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("postgresql://")) throw new Error("TEST_POSTGRES_URL_REQUIRED");
const pg = new SQL(url);
try {
  const rows = await pg`select current_user as username, current_database() as database, 1 as ok`;
  if (rows.length !== 1 || rows[0].ok !== 1) throw new Error("POSTGRES_PROBE_FAILED");
  console.log("PASS Bun.SQL driver TCP connection", {database:rows[0].database,username:rows[0].username});
} finally {
  await pg.close();
}
