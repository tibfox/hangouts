import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  LIVEKIT_HOST: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  HIVE_API_NODE: z.string().url().default('https://api.hive.blog'),
  AUDIO_API_URL: z.string().url().default('https://audio.3speak.tv'),
  AUDIO_API_KEY: z.string().default(''),
  EMBED_UPLOAD_URL: z.string().url().default('https://embed.3speak.tv/uploads'),
  EMBED_API_URL: z.string().url().default('https://embed.3speak.tv/api'),
  EMBED_API_KEY: z.string().default(''),
  // Long-form video upload service (general /studio uploads — NOT shorts).
  VIDEO_UPLOAD_URL: z.string().url().default('https://video.3speak.tv'),
  VIDEO_UPLOAD_TOKEN: z.string().default(''),
  STUDIO_FRONTEND_URL: z.string().url().default('https://3speak.tv'),
  MONGODB_URI: z.string().default(''),
  PORT: z.coerce.number().default(3002),
  // 3Speak Pro one-time trial. ENABLE_PRO_TESTING=true exposes
  // POST /premium/start-testing for any signed-in user; PRO_TESTING_DURATION_HOURS
  // bounds the trial window (defaults to a single day).
  ENABLE_PRO_TESTING: z.coerce.boolean().default(false),
  PRO_TESTING_DURATION_HOURS: z.coerce.number().positive().default(24),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
