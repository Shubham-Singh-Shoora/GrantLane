import { ApplicationForm } from "@/components/ApplicationForm";

export const metadata = { title: "Apply · GrantLane" };

export default function ApplyPage() {
  return (
    <div className="animate-rise">
      <div className="pb-6 pt-6">
        <p className="card-kicker m-0">Applicant</p>
        <h1 className="mb-2 mt-1 text-[40px]">Apply for a grant</h1>
        <p className="m-0 max-w-[62ch] text-[15px]" style={{ opacity: 0.7 }}>
          Tell the granter what you&apos;re building and how you&apos;d break the work into milestones. Once funded,
          each milestone is escrowed on Base. You claim it with evidence and a small bond; if nobody disputes the claim
          within its window, it pays out.
        </p>
      </div>

      <ApplicationForm />
    </div>
  );
}
