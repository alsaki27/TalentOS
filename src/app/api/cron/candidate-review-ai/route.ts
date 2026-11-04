import { NextRequest, NextResponse } from "next/server";
import { processPendingReviewAi } from "@/server/services/candidateReviewAiService";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret || request.headers.get("authorization")!==`Bearer ${secret}`) {
    return NextResponse.json({error:"Unauthorized"},{status:401});
  }
  try {
    return NextResponse.json({ok:true,...await processPendingReviewAi({budgetMs:50_000})});
  } catch(error) {
    console.error("[candidate-review-ai] Recovery tick failed",error);
    return NextResponse.json({error:"Could not process pending review AI checks."},{status:500});
  }
}
