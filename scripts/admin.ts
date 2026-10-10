import "dotenv/config";
import {
  randomUUID,
  createCipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { hash } from "bcryptjs";
import { sql } from "drizzle-orm";
import { TOTP, Secret } from "otpauth";
import { query } from "../src/lib/db";
import { record } from "../src/lib/audit";
const email = process.env.BOOTSTRAP_ADMIN_EMAIL,
  name = process.env.BOOTSTRAP_ADMIN_NAME,
  password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !name || !password || password.length < 16)
  throw new Error(
    "Supply BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and a private BOOTSTRAP_ADMIN_PASSWORD of at least 16 characters.",
  );
if (email.endsWith(".test") && process.env.NODE_ENV === "production")
  throw new Error("Test accounts cannot be bootstrapped in production.");
let secret: string | null = null;
if (process.env.BOOTSTRAP_MFA_SECRET) {
  if (
    !process.env.MFA_ENCRYPTION_KEY ||
    process.env.MFA_ENCRYPTION_KEY.length < 32
  )
    throw new Error(
      "MFA_ENCRYPTION_KEY must contain at least 32 random characters.",
    );
  const raw = process.env.BOOTSTRAP_MFA_SECRET;
  new TOTP({ secret: Secret.fromBase32(raw) });
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update(process.env.MFA_ENCRYPTION_KEY).digest(),
      iv,
    );
  const data = Buffer.concat([cipher.update(raw), cipher.final()]);
  secret =
    iv.toString("hex") +
    "." +
    cipher.getAuthTag().toString("hex") +
    "." +
    data.toString("hex");
}
if (process.env.REQUIRE_TEACHER_MFA === "true" && !secret)
  throw new Error(
    "Provide BOOTSTRAP_MFA_SECRET from your authenticator provisioning process.",
  );
const role = process.env.BOOTSTRAP_ROLE ?? "ADMIN";
if (!["ADMIN", "TEACHER"].includes(role))
  throw new Error("BOOTSTRAP_ROLE must be ADMIN or TEACHER.");
const id = randomUUID();
await query(
  sql`INSERT INTO users(id,email,name,password_hash,role,mfa_secret) VALUES(${id},${email.toLowerCase()},${name},${await hash(password, 12)},${role},${secret})`,
);
await record({ userId: id, type: "ADMIN_BOOTSTRAPPED" });
console.log(
  "Administrator created. Remove bootstrap environment variables after use.",
);
process.exit(0);
