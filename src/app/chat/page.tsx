import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isValidUsername, otherUser } from "@/lib/auth";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  const cookieStore = await cookies();
  const username = cookieStore.get(SESSION_COOKIE)?.value;

  if (!username || !isValidUsername(username)) {
    redirect("/");
  }

  const peer = otherUser(username!) ?? "the other user";

  return <ChatClient currentUser={username!} peerUser={peer} />;
}
