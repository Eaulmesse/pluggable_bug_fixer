import dotenv from 'dotenv';
dotenv.config();

function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export const config = {
  github: { token: env('GITHUB_TOKEN') },
  llm: { 
    apiKey: env('LLM_API_KEY'), 
    baseUrl: env('LLM_BASE_URL'), 
    model: env('LLM_MODEL') 
  },
  email: {
    host: env('EMAIL_HOST'),
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    user: env('EMAIL_USER'),
    pass: env('EMAIL_PASS'),
    from: env('EMAIL_FROM'),
    to: env('EMAIL_TO'),
  },
  app: { port: parseInt(process.env.PORT || '3000') },
};