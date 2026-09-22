import { Redis } from "@upstash/redis";

// Singleton Upstash Redis client (REST/HTTPS based — no persistent TCP
// socket), stashed on `globalThis` so Next.js dev-mode hot reloads don't
// recreate it unnecessarily.
//
// This replaces the old `globalThis`-based in-memory store. Using a real
// shared Redis instance fixes the class of bugs where chat history would
// "mess up" or old messages would reappear: those happened because each
// serverless/server instance had its own separate in-memory copy of the
// data. Redis gives every instance a single, consistent source of truth.
//
// We use Upstash's REST client (not `ioredis`/TCP) specifically because
// this app is deployed on Vercel's Hobby (free) tier: serverless functions
// are short-lived and can spin up many concurrent instances, and a
// TCP-based client would open a persistent socket per instance — quickly
// exhausting a free-tier Redis connection limit. Upstash's stateless
// HTTPS requests avoid that problem entirely and are the officially
// recommended approach for serverless deployments.
//
// Setup:
//   1. Create a free database at https://upstash.com (or add the Upstash
//      Redis integration from the Vercel Marketplace, which sets the env
//      vars for you automatically).
//   2. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your
//      environment (.env.local for dev, Vercel project settings for prod).

const globalForRedis = globalThis as unknown as { __redisClient?: Redis };

function createClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN environment variables. " +
        "Set them in .env.local (dev) or your Vercel project settings (production). " +
        "See .env.local.example for details."
    );
  }

  return new Redis({ url, token });
}

function getClient(): Redis {
  if (!globalForRedis.__redisClient) {
    globalForRedis.__redisClient = createClient();
  }
  return globalForRedis.__redisClient;
}

// Lazily-initialized proxy: the real client (and its env-var validation)
// is only created the first time a method is actually called at runtime,
// not when this module is imported/evaluated. This matters because
// Next.js evaluates route modules during the production build's route
// data collection step, before any env vars or actual requests exist —
// eagerly constructing the client there would throw and break `next build`.
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
