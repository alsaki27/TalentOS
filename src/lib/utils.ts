// src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sanitizeError(error: unknown): { message: string; status: number } {
  console.error("[API] Error:", error);

  if (error && typeof error === "object") {
    const e = error as Record<string, any>;
    if (typeof e.statusCode === "number") {
      return { message: String(e.message || "Something went wrong"), status: e.statusCode };
    }
    if (typeof e.userMessage === "string") {
      return { message: e.userMessage, status: 400 };
    }
  }

  if (error instanceof Error) {
    return { message: "Something went wrong. Please try again.", status: 500 };
  }

  return { message: "Something went wrong. Please try again.", status: 500 };
}

export function sanitizeApiError(err: unknown): string {
  if (err instanceof Error) {
    console.error("[API Error]", err.message, err.stack?.slice(0, 200));
    if ((err as any).statusCode) return err.message;
    return "An unexpected error occurred. Please try again.";
  }
  return "An unexpected error occurred.";
}
