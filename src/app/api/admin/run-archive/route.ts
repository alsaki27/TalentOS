import { NextResponse } from "next/server";
import { query, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log("Creating archived_jobs table if it does not exist...");
    await execute(`
      CREATE TABLE IF NOT EXISTS archived_jobs (
          LIKE jobs INCLUDING ALL
      );
    `);

    console.log("Archiving jobs created before 2026-07-10...");
    
    // Start a transaction for safe migration
    await execute("BEGIN");
    
    const insertRes = await query(`
      INSERT INTO archived_jobs
      SELECT * FROM jobs 
      WHERE created_at < '2026-07-10'
      ON CONFLICT (id) DO NOTHING
      RETURNING id;
    `);
    
    const deleteRes = await query(`
      DELETE FROM jobs 
      WHERE created_at < '2026-07-10'
      RETURNING id;
    `);

    await execute("COMMIT");

    return NextResponse.json({
      success: true,
      archivedCount: insertRes.length,
      deletedCount: deleteRes.length
    });
  } catch (error: any) {
    await execute("ROLLBACK");
    console.error("Migration failed, rolled back:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
