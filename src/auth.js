const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";

if (!JWT_SECRET || JWT_SECRET === "change-this-to-a-long-random-string") {
  // eslint-disable-next-line no-console
  console.warn(
    "\n⚠ JWT_SECRET is missing or still the placeholder value from .env.example.\n" +
      "  Set a real random secret before deploying anywhere real people can reach —\n" +
      "  anyone who guesses it could forge logins.\n"
  );
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, username: user.username, role: user.role },
    JWT_SECRET || "insecure-dev-secret-do-not-use-in-production",
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET || "insecure-dev-secret-do-not-use-in-production");
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken };
