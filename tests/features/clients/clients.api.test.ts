import "dotenv/config";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { clientsFeatureRoute } from "@/features/clients/index.js";

const app = new Hono();
app.route("/clients", clientsFeatureRoute);

describe("Clients API E2E", () => {
  let createdId: string;

  it("POST /clients creates a client", async () => {
    const res = await app.request("/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Vitest Test Client",
        lifecycleStage: "prospect",
        tags: ["vitest"],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Vitest Test Client");
    expect(body.lifecycleStage).toBe("prospect");
    createdId = body.id;
  });

  it("GET /clients/:id returns created client", async () => {
    const res = await app.request(`/clients/${createdId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdId);
    expect(body.tags).toContain("vitest");
  });

  it("PATCH /clients/:id updates", async () => {
    const res = await app.request(`/clients/${createdId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ healthScore: 77 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.healthScore).toBe(77);
  });

  it("POST /clients/:id/activities creates + timeline returns it", async () => {
    const addRes = await app.request(`/clients/${createdId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "note", title: "Test note", body: "body test" }),
    });
    expect(addRes.status).toBe(201);

    const listRes = await app.request(`/clients/${createdId}/activities`);
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0].title).toBe("Test note");
  });

  it("DELETE /clients/:id soft-deletes + GET returns 404", async () => {
    const delRes = await app.request(`/clients/${createdId}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const getRes = await app.request(`/clients/${createdId}`);
    expect(getRes.status).toBe(404);
  });

  it("POST /clients/:id/restore brings it back", async () => {
    const restoreRes = await app.request(`/clients/${createdId}/restore`, {
      method: "POST",
    });
    expect(restoreRes.status).toBe(200);

    const getRes = await app.request(`/clients/${createdId}`);
    expect(getRes.status).toBe(200);
  });

  it("GET /clients lists at least 1 (the seed + new ones)", async () => {
    const res = await app.request("/clients?limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.nextCursor).toBeTruthy();
  });
});
