import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Card, LogoMark } from "@/design/components";
import { getActiveWorkspace } from "@/src/workspace/active";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getActiveWorkspace();
  return {
    title: `Sign in · ${config.brand.productName}`,
  };
}

// Next 16 always passes `searchParams` as a Promise (the sync form was removed in
// 15). The generated `PageProps` validator rejects the old sync-or-Promise union, so
// this is Promise-only; the code below already awaits it, so behavior is unchanged.
type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  const { config } = await getActiveWorkspace();
  const { productName, companyName } = config.brand;

  return (
    // The same health-blue hero the feed wears, so signing in already feels like
    // the product. A glass card floats one calm, single primary action on top.
    <main className="gradient-hero relative flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col gap-8">
        {/* The wordmark links to the marketing front door — the standard "logo is home"
            affordance, and the requested way in to /welcome from sign-in. */}
        <Link
          href="/welcome"
          aria-label="What is Moment"
          className="flex items-center justify-center gap-2.5 rounded-control focus-visible:outline-white"
        >
          <LogoMark size={26} />
          <span className="font-display text-xl font-book tracking-brand text-white">
            {companyName}
          </span>
          <span className="rounded-pill bg-white/15 px-2.5 py-1 font-mono text-xs font-medium uppercase leading-none text-white">
            {productName}
          </span>
        </Link>

        <Card variant="glass" padding="lg">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 text-center">
              <h1 className="font-display text-h4 font-book tracking-brand text-ink">
                Sign in
              </h1>
              <p className="mx-auto max-w-sm font-sans text-sm text-ink-muted">
                Access is limited to allowlisted accounts. Use your work email and
                we will send you a one-time sign-in link.
              </p>
            </div>

            {error && (
              <p className="rounded-control bg-danger/10 px-3.5 py-2.5 font-sans text-sm text-danger">
                {error === "not_allowed"
                  ? "That email is not on the allowlist."
                  : "That sign-in link could not be used. Please request a fresh link."}
              </p>
            )}

            <LoginForm />
          </div>
        </Card>

        {/* The pre-signup front door: a brand-new business adapts the whole engine
            to itself in about two minutes. Kept distinct from the sign-in card
            above (white-on-hero, not the card's purple) so the two paths never
            compete as one screen's two primaries. */}
        <div className="flex flex-col items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-eyebrow text-white/70">
            New here?
          </span>
          <ButtonLink href="/adapt" variant="primary-dark" size="lg" className="w-full">
            Adapt it to your business
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
