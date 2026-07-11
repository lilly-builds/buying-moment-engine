import { ButtonLink, Card, PageContainer, SectionHeader, TopNav } from "@/design/components";
import { getActiveWorkspace } from "@/src/workspace/active";
import { SampleBriefView } from "./sample-brief-view";

// Resolve the active workspace at request time — never at build time — so a keyless
// clone renders the designed "not found" state instead of crashing. Same contract as
// `app/page.tsx`.
export const dynamic = "force-dynamic";

/**
 * The sample-brief detail page (Adapt-It P4). The tenant feed's "View brief" links
 * here as `/prospect/{id}`.
 *
 * Server component: it resolves the active workspace and finds the `sampleFeed`
 * prospect by id, then hands it to the `<SampleBriefView>` client island. The
 * EliseAI default path is left entirely alone — the default renders its feed from
 * the `practices` table and its briefs at `/practice/{id}`, so this route 404s for
 * the default workspace (there is no sample feed to read) and for any id that is
 * not in the active tenant's feed.
 */
export default async function ProspectBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await getActiveWorkspace();

  // The default (id === "default") has no sample feed — its briefs live at
  // /practice/{id}. Anything else that isn't in this tenant's feed is a real miss.
  const prospect =
    workspace.id === "default"
      ? undefined
      : workspace.config.sampleFeed.find((p) => p.id === id);

  if (!prospect) return <ProspectNotFound />;

  return <SampleBriefView prospect={prospect} />;
}

/**
 * A designed stand-in for a prospect that isn't in the active feed, on the SAME
 * health-blue surface as the feed and the brief so the user never lands on a bare
 * error. Mirrors `app/practice/[id]/page.tsx`'s `BriefUnavailable`.
 */
function ProspectNotFound() {
  return (
    <div className="gradient-hero flex flex-1 flex-col">
      <TopNav tone="dark" />
      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-1 items-center justify-center py-16">
          <Card variant="elevated" padding="lg" className="max-w-lg">
            <div className="flex flex-col items-start gap-5">
              <SectionHeader
                eyebrow="Sample brief"
                title="We couldn't find that prospect"
                size="h3"
                as="h1"
              />
              <p className="font-sans text-base text-ink-muted">
                This prospect isn&apos;t in your feed. It may have been from a different
                workspace, or the link is out of date. Head back to your feed to pick a
                live one.
              </p>
              <ButtonLink href="/" variant="secondary" size="md">
                Back to the feed
              </ButtonLink>
            </div>
          </Card>
        </PageContainer>
      </main>
    </div>
  );
}
