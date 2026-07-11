import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INDUSTRY_SLUGS, getIndustry } from "../industries";

/**
 * Programmatic SEO page: /moments/[industry]. Statically generated for the seed
 * industries; unknown slugs 404. Funnels to the industry's assigned landing
 * variant with utm_source=seo.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRY_SLUGS.map((industry) => ({ industry }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ industry: string }>;
}): Promise<Metadata> {
  const { industry } = await params;
  const data = getIndustry(industry);
  if (!data) return {};
  const title = `${data.h1}: the public signals that mean they are ready`;
  const description = `${data.intro} A field guide to the buying moments in ${data.label}, and how to reach them the moment they need you.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

const DISPLAY = "var(--font-inter-tight), system-ui, sans-serif";
const BODY = "var(--font-inter), system-ui, sans-serif";
const MONO = "var(--font-ibm-plex-mono), ui-monospace, monospace";

const C = {
  accent: "#4f46e5",
  ink: "#0b1020",
  inkMuted: "#5b6472",
  line: "#e6e8f2",
  card: "#f7f8fc",
  soft: "#eef1fe",
};

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ industry: string }>;
}) {
  const { industry } = await params;
  const data = getIndustry(industry);
  if (!data) notFound();

  const cta = `/for/${data.variant}?utm_source=seo&utm_medium=organic&utm_campaign=moments-${data.slug}`;

  return (
    <main style={{ background: "#ffffff", color: C.ink, minHeight: "100vh", fontFamily: BODY }}>
      <header className="mx-auto flex w-full max-w-[760px] items-center justify-between px-6 py-6">
        <Link href="/moments" className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: C.accent }} aria-hidden />
          <span className="text-[17px] font-semibold" style={{ fontFamily: DISPLAY, letterSpacing: "-0.01em" }}>Buying Moment</span>
        </Link>
        <Link href={cta} className="text-[14px] font-semibold" style={{ color: C.accent }}>Get 3 free briefs</Link>
      </header>

      <article className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-4">
        <p className="text-[13px] font-semibold uppercase" style={{ fontFamily: MONO, color: C.accent, letterSpacing: "0.08em" }}>
          Field guide
        </p>
        <h1 className="mt-3 text-[clamp(2rem,5vw,3rem)] font-medium" style={{ fontFamily: DISPLAY, letterSpacing: "-0.025em", lineHeight: 1.06, textWrap: "balance" }}>
          {data.h1}
        </h1>
        <p className="mt-4 text-[18px] leading-relaxed" style={{ color: C.inkMuted }}>{data.intro}</p>

        <div className="mt-10 flex flex-col gap-4">
          {data.moments.map((m, i) => (
            <section key={m.title} className="rounded-2xl border p-6" style={{ borderColor: C.line, background: C.card }}>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: C.soft, color: C.accent, fontFamily: MONO }}>{i + 1}</span>
                <h2 className="text-[19px] font-semibold" style={{ fontFamily: DISPLAY }}>{m.title}</h2>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: C.ink }}>{m.why}</p>
              <p className="mt-2.5 text-[12px]" style={{ fontFamily: MONO, color: C.inkMuted }}>Shows up in: {m.where}</p>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 rounded-2xl border-2 p-7 text-center sm:p-8" style={{ borderColor: C.accent, background: C.soft }}>
          <h2 className="text-[clamp(1.3rem,3vw,1.8rem)] font-medium" style={{ fontFamily: DISPLAY, letterSpacing: "-0.02em", textWrap: "balance" }}>
            You do not have time to watch all of these. We do.
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px]" style={{ color: C.inkMuted }}>
            Buying Moment watches every one of these signals in {data.label} and hands you the company, the person, and the
            first email, already written. Get your first 3 free.
          </p>
          <Link href={cta} className="mt-5 inline-block rounded-xl px-6 py-3 text-[15px] font-semibold transition hover:opacity-90" style={{ background: C.accent, color: "#fff" }}>
            Get my 3 free briefs
          </Link>
        </div>

        <p className="mt-8 text-center text-[14px]">
          <Link href="/moments" style={{ color: C.accent }}>See buying moments for other industries →</Link>
        </p>
      </article>
    </main>
  );
}
