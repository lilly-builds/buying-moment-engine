import { ButtonLink, Card, PageContainer, SectionHeader, TopNav } from "@/design/components";
import { getActiveWorkspace } from "@/src/workspace/active";
import { CustomizeStudio } from "./customize-studio";

// Resolve the active workspace at request time — never at build time. Same contract
// as `app/page.tsx`.
export const dynamic = "force-dynamic";

/**
 * The Customization Studio page (Adapt-It P4). The nav's "Customize" link lands here.
 *
 * Server component: it resolves the active workspace and hands its config to the
 * `<CustomizeStudio>` client editor. The synthetic EliseAI default (id === "default")
 * is the demo tenant and must not be edited (there is no DB row to write, and the
 * default is a locked showcase), so it gets a friendly read-only state that points
 * the user at `/adapt` to build their own workspace first.
 */
export default async function CustomizePage() {
  const workspace = await getActiveWorkspace();

  if (workspace.id === "default") {
    return <ReadOnlyDefault />;
  }

  return <CustomizeStudio initialConfig={workspace.config} />;
}

/**
 * The read-only state for the demo default — the studio has nothing to save to, so
 * instead of a broken editor it invites the user to adapt the engine to their own
 * business, on the same health-blue surface as the rest of the app.
 */
function ReadOnlyDefault() {
  return (
    <div className="gradient-hero-calm flex flex-1 flex-col">
      <TopNav tone="dark" />
      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-1 items-center justify-center py-16">
          <Card variant="elevated" padding="lg" className="max-w-xl">
            <div className="flex flex-col items-start gap-5">
              <SectionHeader
                eyebrow="Customize"
                title="This is the demo engine"
                description="You're looking at the built-in example. To change the brand, the buying-moment signals, the pitch, and the proof, adapt the engine to your own business first. It takes about two minutes, and everything the Adapter sets is yours to edit here."
                size="h3"
                as="h1"
              />
              <ButtonLink href="/adapt" variant="primary" size="md">
                Adapt the engine to your business
              </ButtonLink>
            </div>
          </Card>
        </PageContainer>
      </main>
    </div>
  );
}
