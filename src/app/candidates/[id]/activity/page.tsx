"use client";
import { useParams } from "next/navigation";
import { CandidateActivity } from "@/components/candidates/CandidateActivity";

export default function CandidateActivityPage() {
  const { id } = useParams<{ id: string }>();
  return <CandidateActivity candidateId={id} full />;
}
