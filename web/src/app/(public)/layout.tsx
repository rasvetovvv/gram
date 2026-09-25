import { PublicInfoShell } from "@/components/public/public-shell";

export default function PublicInfoLayout({ children }: { children: React.ReactNode }) {
  return <PublicInfoShell>{children}</PublicInfoShell>;
}
