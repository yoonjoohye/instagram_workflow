import type { Tone } from "@/components/ui";
import type { JobStatus } from "./types";

export function statusTone(status: JobStatus): Tone {
  switch (status) {
    case "published":
      return "good";
    case "failed":
      return "bad";
    case "ready":
      return "accent";
    case "generating":
    case "publishing":
      return "warn";
    default:
      return "neutral";
  }
}
