/**
 * PostgreSQL da qarz_daftar bazasini yaratadi (agar bo'lmasa).
 * Ishga tushirish: node scripts/create-db.js
 * .env dagi DATABASE_URL dan host, port, user, password olinadi.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL .env da belgilang.");
  process.exit(1);
}

const u = new URL(url);
const config = {
  host: u.hostname,
  port: parseInt(u.port || "5432", 10),
  user: u.username,
  password: u.password,
  database: "postgres",
};

const dbName = u.pathname.replace(/^\//, "") || "qarz_daftar";

async function main() {
  const client = new Client(config);
  try {
    await client.connect();
    const res = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (res.rows.length > 0) {
      console.log(`Baza "${dbName}" allaqachon mavjud.`);
      return;
    }
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Baza "${dbName}" muvaffaqiyatli yaratildi.`);
  } catch (err) {
    console.error("Xato:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
