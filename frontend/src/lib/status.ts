import type { Tone } from "@/components/ui";
import type { JobStatus } from "./types";

export function statusTone(status: JobStatus): Tone {
  switch (status) {
    case "published":
      return "good";
    case "failed":
      return "bad";
    case "deleted":
    case "expired":
      return "neutral";
    case "ready":
    case "scheduled":
      return "accent";
    case "generating":
    case "publishing":
      return "warn";
    default:
      return "neutral";
  }
}
