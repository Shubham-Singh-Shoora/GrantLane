import { MyApplications } from "@/components/MyApplications";

export const metadata = { title: "My applications · GrantLane" };

export default function MyApplicationsPage() {
  return (
    <div className="animate-rise">
      <div className="pb-6 pt-6">
        <p className="card-kicker m-0">Applicant</p>
        <h1 className="mb-2 mt-1 text-[40px]">My applications</h1>
        <p className="m-0 max-w-[58ch] text-[15px]" style={{ opacity: 0.7 }}>
          Everything you&apos;ve submitted, and where the granter has got to with it. This page checks for updates on
          its own — you don&apos;t need to keep refreshing.
        </p>
      </div>

      <MyApplications />
    </div>
  );
}
