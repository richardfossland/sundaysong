import { redirect } from "next/navigation";

// Merged into the single tabbed /recommendations surface (RecommendWorkspace).
// Kept as a redirect so existing deep links keep working.
export default function RedirectFlow() {
  redirect("/recommendations?mode=flow");
}
