// Static credentials for the two chat users.
// NOTE: These are placeholder credentials for a demo app only.
// Replace with a real auth system before using this in production.
export type StaticUser = {
  username: string;
  password: string;
};

export const STATIC_USERS: StaticUser[] = [
  { username: "alice", password: "alice123" },
  { username: "bob", password: "bob123" },
];

export const SESSION_COOKIE = "chat_session";

export function validateCredentials(username: string, password: string): boolean {
  return STATIC_USERS.some(
    (u) => u.username === username && u.password === password
  );
}

export function otherUser(username: string): string | null {
  const found = STATIC_USERS.find((u) => u.username !== username);
  return found ? found.username : null;
}

export function isValidUsername(username: string): boolean {
  return STATIC_USERS.some((u) => u.username === username);
}
