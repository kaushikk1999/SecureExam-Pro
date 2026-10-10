import { branding } from "@/lib/branding";
import LandingExperience from "@/components/landing-experience";
export const dynamic = "force-dynamic";
export default async function Home() {
  return <LandingExperience brand={await branding()} />;
}
