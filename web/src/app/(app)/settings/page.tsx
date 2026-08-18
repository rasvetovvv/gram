"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProfileEditSheet } from "@/components/profile/profile-edit-sheet";

/** `/settings` stays a valid entry point: it opens the account sheet over the previous screen. */
export default function SettingsPage() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <ProfileEditSheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) router.back();
      }}
    />
  );
}
