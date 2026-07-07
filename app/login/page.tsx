import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · GTM Maestro",
};

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">GTM Maestro</h1>
        <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
          Access is limited to allowlisted accounts. Sign in with your work
          email to reach the feed.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
