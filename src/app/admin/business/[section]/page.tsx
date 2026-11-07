import { notFound } from "next/navigation";
import { sections } from "@/lib/business/config";
import { BusinessPage } from "../workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ q?: string; page?: string; status?: string; record?: string; client?: string; folder?: string; new?: string }> }) {
  const slug = (await params).section;
  const section = sections.find(s => s.id === slug && s.id !== "overview");
  if (!section) notFound();
  return <BusinessPage section={section.id} params={await searchParams} />;
}
