import dotenv from 'dotenv';
import { Config } from '../types';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config: Config = {
  github: {
    token: requireEnv('GITHUB_TOKEN'),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  llm: {
    apiKey: requireEnv('LLM_API_KEY'),
    baseUrl: process.env.LLM_BASE_URL || 'https://api.opencode.ai/v1',
    model: process.env.LLM_MODEL || 'kimi-k2.5',
  },
  email: {
    host: requireEnv('EMAIL_HOST'),
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    user: requireEnv('EMAIL_USER'),
    pass: requireEnv('EMAIL_PASS'),
    from: requireEnv('EMAIL_FROM'),
    to: requireEnv('EMAIL_TO'),
  },
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    scanInterval: process.env.SCAN_INTERVAL || '0 */6 * * *',
    validationUrl: requireEnv('VALIDATION_URL'),
  },
};