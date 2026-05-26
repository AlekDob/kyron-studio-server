import "dotenv/config";
import { faker } from "@faker-js/faker";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL non definito");

const ORG_ID = process.env.SEED_ORG_ID ?? "00000000-0000-0000-0000-000000000001";
const USER_ID = process.env.SEED_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const TOTAL = Number(process.env.SEED_TOTAL ?? 10000);

const stages = ["prospect", "active", "inactive", "churned", "blacklisted"] as const;
const countries = ["IT", "IT", "IT", "FR", "DE", "ES"] as const;
const regions = ["Puglia", "Lombardia", "Veneto", "Sicilia", "Lazio", "Campania"];
const industries = ["Retail", "Manifattura", "Edilizia", "Servizi", "Agricoltura", "Tech"];
const tagPool = ["premium", "tier-1", "discount", "pay-60", "risky", "strategic", "legacy", "new"];

async function main() {
  const sql = postgres(connectionString!, { max: 1 });

  console.log(`[seed] generating ${TOTAL} clients for org=${ORG_ID}…`);

  const batchSize = 500;
  for (let i = 0; i < TOTAL; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, TOTAL - i) }, () => ({
      org_id: ORG_ID,
      name: faker.company.name(),
      legal_name: faker.company.name() + " S.r.l.",
      vat_number: `IT${faker.string.numeric(11)}`,
      fiscal_code: faker.string.alphanumeric({ length: 16, casing: "upper" }),
      website: faker.internet.url(),
      industry: faker.helpers.arrayElement(industries),
      country: faker.helpers.arrayElement(countries),
      region: faker.helpers.arrayElement(regions),
      city: faker.location.city(),
      address: faker.location.streetAddress(),
      lifecycle_stage: faker.helpers.arrayElement(stages),
      tags: faker.helpers.arrayElements(tagPool, { min: 0, max: 3 }),
      metadata: {
        sdi_code: faker.string.alphanumeric({ length: 7, casing: "upper" }),
        pec_email: faker.internet.email(),
      },
      last_interaction_at: faker.date.recent({ days: 180 }),
      total_revenue_eur: faker.number.float({ min: 0, max: 500000, fractionDigits: 2 }),
      health_score: faker.number.int({ min: 0, max: 100 }),
      created_by: USER_ID,
      updated_by: USER_ID,
    }));

    await sql`
      INSERT INTO clients ${sql(batch, "org_id", "name", "legal_name", "vat_number", "fiscal_code",
        "website", "industry", "country", "region", "city", "address",
        "lifecycle_stage", "tags", "metadata", "last_interaction_at",
        "total_revenue_eur", "health_score", "created_by", "updated_by")}
    `;
    console.log(`[seed] inserted ${Math.min(i + batchSize, TOTAL)} / ${TOTAL}`);
  }

  console.log("[seed] adding 1-3 contacts per first 1000 clients…");
  const firstClients = await sql<{ id: string }[]>`
    SELECT id FROM clients WHERE org_id = ${ORG_ID} ORDER BY created_at LIMIT 1000
  `;

  for (const c of firstClients) {
    const n = faker.number.int({ min: 1, max: 3 });
    const contacts = Array.from({ length: n }, (_, idx) => ({
      org_id: ORG_ID,
      client_id: c.id,
      first_name: faker.person.firstName(),
      last_name: faker.person.lastName(),
      role: faker.helpers.arrayElement(["CEO", "Buyer", "CFO", "Sales", "Tecnico"]),
      email: faker.internet.email(),
      phone: faker.phone.number(),
      is_primary: idx === 0,
    }));
    await sql`INSERT INTO client_contacts ${sql(contacts, "org_id", "client_id",
      "first_name", "last_name", "role", "email", "phone", "is_primary")}`;
  }

  console.log("[seed] adding 3-10 activities per first 500 clients…");
  const activeClients = firstClients.slice(0, 500);
  for (const c of activeClients) {
    const n = faker.number.int({ min: 3, max: 10 });
    const activities = Array.from({ length: n }, () => ({
      org_id: ORG_ID,
      client_id: c.id,
      kind: faker.helpers.arrayElement(["note", "call", "email", "meeting"]),
      title: faker.lorem.sentence(4),
      body: faker.lorem.paragraph(),
      actor_type: "user" as const,
      actor_id: USER_ID,
      occurred_at: faker.date.recent({ days: 90 }),
    }));
    await sql`INSERT INTO client_activities ${sql(activities, "org_id", "client_id",
      "kind", "title", "body", "actor_type", "actor_id", "occurred_at")}`;
  }

  await sql.end();
  console.log("[seed] done.");
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
