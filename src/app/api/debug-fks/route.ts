import { NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export async function GET() {
  const q = `
    SELECT
      tc.table_name AS foreign_table,
      kcu.column_name AS foreign_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column
    FROM
      information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
    WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'applications';
  `;
  try {
    const res = await query(q);
    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
