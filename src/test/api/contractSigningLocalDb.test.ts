import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
const fixture = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/server/db/neon", () => ({
  query: async (text: string, params: unknown[]) =>
    (await fixture.pool!.query(text, params)).rows,
  queryOne: async (text: string, params: unknown[]) =>
    (await fixture.pool!.query(text, params)).rows[0] ?? null,
}));
vi.mock("@/server/services/contractSigningPdf", () => ({
  renderSignedContractPdf: async () => Buffer.from("%PDF-synthetic-test-only"),
}));
import { saveSignedContract } from "@/server/services/contractSigningService";
import { validateContractSigning } from "@/lib/contractSignature";
const candidate = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe.skipIf(process.env.CONTRACT_LOCAL_DB_TEST !== "1")(
  "contract atomic persistence in isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      fixture.pool = new Pool({
        host: "127.0.0.1",
        port: 55439,
        user: process.env.USER,
        database: "postgres",
        max: 1,
      });
      await fixture.pool.query(
        "CREATE SCHEMA contract_test; SET search_path=contract_test; CREATE TABLE candidates(id uuid PRIMARY KEY);",
      );
      await fixture.pool.query(
        await readFile(
          "sql/neon_fixes/117_candidate_contracts_and_portal_onboarding.sql",
          "utf8",
        ),
      );
      const migration = await readFile(
        "sql/neon_fixes/149_candidate_signed_contracts.sql",
        "utf8",
      );
      await fixture.pool.query(migration);
      await fixture.pool.query(migration);
      await fixture.pool.query(
        "INSERT INTO candidates(id,has_contract) VALUES($1,false)",
        [candidate],
      );
    });
    afterAll(async () => {
      if (fixture.pool) {
        await fixture.pool.query("DROP SCHEMA contract_test CASCADE");
        await fixture.pool.end();
      }
    });
    it("commits receipt, acceptance, SSN choice and two delivery jobs once; repeats cannot replace signature", async () => {
      const input = validateContractSigning({
        signerName: "Test Client",
        signerEmail: "client@example.com",
        signingDate: new Date().toISOString().slice(0, 10),
        signature: { type: "typed", text: "Test Client" },
        signatureConsent: true,
      });
      const first = await saveSignedContract(candidate, input, false, null);
      const again = await saveSignedContract(
        candidate,
        { ...input, signerEmail: "other@example.com" },
        false,
        null,
      );
      expect(again.id).toBe(first.id);
      const signed = (
        await fixture.pool!.query("SELECT * FROM candidate_signed_contracts")
      ).rows;
      expect(signed).toHaveLength(1);
      expect(signed[0].signer_email).toBe("client@example.com");
      expect(
        (
          await fixture.pool!.query(
            "SELECT * FROM candidate_portal_acceptances",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (await fixture.pool!.query("SELECT * FROM candidate_ssn_records"))
          .rows[0].has_ssn,
      ).toBe(false);
      expect(
        (
          await fixture.pool!.query(
            "SELECT recipient FROM candidate_contract_deliveries ORDER BY recipient",
          )
        ).rows.map((r) => r.recipient),
      ).toEqual(["client@example.com", "info@skarion.com"]);
      expect(
        (await fixture.pool!.query("SELECT has_contract FROM candidates"))
          .rows[0].has_contract,
      ).toBe(true);
    });
  },
);
