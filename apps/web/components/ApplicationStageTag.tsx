import { applicationStage } from "@/lib/status";

/** The status tag on an application card or page — one mapping, used everywhere. */
export function ApplicationStageTag({ status, completed }: { status: string; completed?: boolean }) {
  const stage = applicationStage(status, completed);
  return <span className={stage.tagClass}>{stage.label}</span>;
}
