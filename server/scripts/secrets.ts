/**
 * Prints fresh random secrets for a production environment: `npm run secrets -w server`.
 * Nothing is written to disk. Copy the lines into your .env (docker-compose) or a secret manager, then discard the
 * terminal output. Run it again for a different set; never reuse a value across environments.
 */
import { randomBytes } from 'crypto';

const token = (bytes: number) => randomBytes(bytes).toString('base64url');

// Satisfies the password policy (upper, lower, digit, symbol) with 128+ bits of randomness behind it
const strongPassword = () => `${token(16)}-Aa9!`;

const lines = [
  `# Generated ${new Date().toISOString()}. Not stored anywhere: copy these now.`,
  `JWT_SECRET=${token(48)}`,
  `JWT_REFRESH_SECRET=${token(48)}`,
  `POSTGRES_PASSWORD=${token(24)}`,
  `SEED_ADMIN_PASSWORD=${strongPassword()}`,
  `# Paste the same value into the Razorpay dashboard webhook "secret" field`,
  `RAZORPAY_WEBHOOK_SECRET=${token(32)}`,
];

console.log(lines.join('\n'));
