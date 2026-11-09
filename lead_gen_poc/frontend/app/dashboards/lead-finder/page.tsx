"use client";

import LeadFinder from "@/components/lead-finder/LeadFinder";

// Same route shape as Shoutly's dashboard pages (app/dashboards/<feature>/page.tsx),
// so this file and components/lead-finder/ copy straight into Shoulty-Ai.
export default function DashboardLeadFinderPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#F9FAFB]">
      <LeadFinder />
    </div>
  );
}
