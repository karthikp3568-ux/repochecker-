"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Opens the print dialog once (Save as PDF), with a manual button as fallback. */
export function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="mb-6 flex items-center gap-3 print:hidden">
      <Button onClick={() => window.print()}>
        <Printer aria-hidden /> Print / Save as PDF
      </Button>
      <span className="text-muted-foreground text-sm">Choose “Save as PDF” as the destination.</span>
    </div>
  );
}
