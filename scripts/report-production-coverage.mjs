#!/usr/bin/env node
import fs from "node:fs";
import postgres from "postgres";
import dotenv from "dotenv";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Source the production env first.");
  process.exit(1);
}

const json = process.argv.includes("--json");
const sql = postgres(databaseUrl, { max: 1 });

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function line(label, n, d) {
  return `${label.padEnd(34)} ${String(n).padStart(5)} / ${String(d).padStart(5)}  ${pct(n, d).padStart(7)}`;
}

try {
  const [summary] = await sql`
    with eligible as (
      select
        p.id,
        p.name,
        p.website_url,
        p.enrichment_status
      from practices p
      join signals s on s.practice_id = p.id
      where p.vertical <> 'unclassified'
        and (p.geo_key is null or p.geo_key not like 'demo:%')
      group by p.id, p.name, p.website_url, p.enrichment_status
      having bool_or(s.expires_at is null or s.expires_at > now())
    ), contact_rollup as (
      select
        c.practice_id,
        count(*)::int as contact_count,
        bool_or(
          c.selected_contact_classification is distinct from 'none'
          and (
            c.name is not null
            or c.email is not null
            or c.linkedin_url is not null
          )
        ) as has_real_contact,
        bool_or(c.name is not null and length(trim(c.name)) > 0) as has_named_contact,
        bool_or(c.email is not null and length(trim(c.email)) > 0) as has_email,
        bool_or(c.email_quality = 'safe_work') as has_safe_work,
        bool_or(c.email_quality = 'weak_work') as has_weak_work,
        bool_or(c.email_quality = 'org_inbox') as has_org_inbox,
        bool_or(c.email_quality = 'personal') as has_personal,
        bool_or(c.selected_contact_classification = 'best_buyer') as has_best_buyer,
        bool_or(c.selected_contact_classification = 'reachable_fallback') as has_reachable_fallback,
        bool_or(c.selected_contact_classification = 'none') as exhausted_no_contact
      from contacts c
      group by c.practice_id
    ), brief_rollup as (
      select b.practice_id, count(*)::int as brief_count
      from briefs b
      group by b.practice_id
    )
    select
      count(*)::int as eligible,
      count(*) filter (where e.website_url is not null and length(trim(e.website_url)) > 0)::int as website_present,
      count(*) filter (where e.website_url is null or length(trim(e.website_url)) = 0)::int as website_missing,
      count(*) filter (where e.enrichment_status = 'enriched')::int as enriched_status,
      count(*) filter (where e.enrichment_status = 'failed')::int as failed_status,
      count(*) filter (where coalesce(cr.has_real_contact, false))::int as has_any_contact,
      count(*) filter (where coalesce(cr.has_named_contact, false))::int as named_contact,
      count(*) filter (where coalesce(cr.has_email, false))::int as person_or_org_email,
      count(*) filter (where coalesce(cr.has_safe_work, false))::int as safe_work,
      count(*) filter (where coalesce(cr.has_weak_work, false))::int as weak_work,
      count(*) filter (where coalesce(cr.has_org_inbox, false))::int as org_inbox,
      count(*) filter (where coalesce(cr.has_personal, false))::int as personal,
      count(*) filter (where coalesce(cr.has_best_buyer, false))::int as best_buyer,
      count(*) filter (where coalesce(cr.has_reachable_fallback, false))::int as reachable_fallback,
      count(*) filter (where coalesce(cr.exhausted_no_contact, false))::int as exhausted_no_contact,
      count(*) filter (where coalesce(br.brief_count, 0) > 0)::int as has_brief,
      count(*) filter (where e.enrichment_status = 'enriched' and coalesce(br.brief_count, 0) = 0)::int as enriched_without_brief
    from eligible e
    left join contact_rollup cr on cr.practice_id = e.id
    left join brief_rollup br on br.practice_id = e.id
  `;

  const denominator = Number(summary.eligible ?? 0);
  const websitePresent = Number(summary.website_present ?? 0);
  const enrichableDenominator = websitePresent;
  const report = {
    generatedAt: new Date().toISOString(),
    denominator: {
      eligibleBuyingMomentLeads: denominator,
      websitePresent,
      websiteMissing: Number(summary.website_missing ?? 0),
    },
    allEligible: {
      enrichedStatus: Number(summary.enriched_status ?? 0),
      failedStatus: Number(summary.failed_status ?? 0),
      anyContact: Number(summary.has_any_contact ?? 0),
      namedContact: Number(summary.named_contact ?? 0),
      personOrOrgEmail: Number(summary.person_or_org_email ?? 0),
      safeWorkEmail: Number(summary.safe_work ?? 0),
      weakWorkEmail: Number(summary.weak_work ?? 0),
      orgInbox: Number(summary.org_inbox ?? 0),
      personalEmail: Number(summary.personal ?? 0),
      bestBuyer: Number(summary.best_buyer ?? 0),
      reachableFallback: Number(summary.reachable_fallback ?? 0),
      exhaustedNoContact: Number(summary.exhausted_no_contact ?? 0),
      hasBrief: Number(summary.has_brief ?? 0),
      enrichedWithoutBrief: Number(summary.enriched_without_brief ?? 0),
    },
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Production coverage report — ${report.generatedAt}`);
    console.log(`Denominator: eligible fresh buying-moment leads`);
    console.log("");
    console.log(line("Website present", websitePresent, denominator));
    console.log(line("Website missing", report.denominator.websiteMissing, denominator));
    console.log("");
    console.log("All eligible leads:");
    console.log(line("Enrichment status = enriched", report.allEligible.enrichedStatus, denominator));
    console.log(line("Any contact", report.allEligible.anyContact, denominator));
    console.log(line("Named contact", report.allEligible.namedContact, denominator));
    console.log(line("Person/org email", report.allEligible.personOrOrgEmail, denominator));
    console.log(line("Safe work email", report.allEligible.safeWorkEmail, denominator));
    console.log(line("Weak work email", report.allEligible.weakWorkEmail, denominator));
    console.log(line("Org inbox", report.allEligible.orgInbox, denominator));
    console.log(line("Best buyer", report.allEligible.bestBuyer, denominator));
    console.log(line("Reachable fallback", report.allEligible.reachableFallback, denominator));
    console.log(line("Exhausted no contact", report.allEligible.exhaustedNoContact, denominator));
    console.log(line("Has brief", report.allEligible.hasBrief, denominator));
    console.log(line("Enriched without brief", report.allEligible.enrichedWithoutBrief, denominator));
    console.log("");
    console.log("Enrichable subset, website-present denominator:");
    console.log(line("Enrichment status = enriched", report.allEligible.enrichedStatus, enrichableDenominator));
    console.log(line("Named contact", report.allEligible.namedContact, enrichableDenominator));
    console.log(line("Person/org email", report.allEligible.personOrOrgEmail, enrichableDenominator));
    console.log(line("Safe work email", report.allEligible.safeWorkEmail, enrichableDenominator));
  }
} finally {
  await sql.end();
}
