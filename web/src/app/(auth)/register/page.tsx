import type { Metadata } from "next";

import { RegisterScreen } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Регистрация" };

export default function RegisterPage() {
  return <RegisterScreen />;
}
