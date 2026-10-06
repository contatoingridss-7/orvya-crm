import { redirect } from "next/navigation";
import { homeSection } from "@/lib/auth/roles";
import { requireCompany } from "@/lib/auth/viewer";

export default async function CompanyIndex({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const { company } = await requireCompany(empresa);
  redirect(`/${company.slug}/${homeSection(company.role)}`);
}
