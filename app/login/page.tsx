import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · GTM Maestro",
};

type LoginPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const code = firstParam(params.code);
  if (code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  }

  const error = firstParam(params.error);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">GTM Maestro</h1>
        <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
          Access is limited to allowlisted accounts. Sign in with your work
          email to reach the feed.
        </p>
        {error && (
          <p className="max-w-sm text-sm text-red-600 dark:text-red-400">
            {error === "not_allowed"
              ? "That email is not on the allowlist."
              : "That sign-in link could not be used. Please request a fresh link."}
          </p>
        )}
      </div>
      <LoginForm />
    </main>
  );
}
