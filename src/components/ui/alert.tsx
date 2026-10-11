import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { icon: Info, cls: "border-info/30 bg-info/5 text-foreground [&>svg]:text-info" },
  success: { icon: CheckCircle2, cls: "border-success/30 bg-success/5 [&>svg]:text-success" },
  warning: { icon: AlertTriangle, cls: "border-warning/30 bg-warning/5 [&>svg]:text-warning" },
  danger: { icon: XCircle, cls: "border-danger/30 bg-danger/5 [&>svg]:text-danger" },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: keyof typeof TONES;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const { icon: Icon, cls } = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border p-4 text-sm", cls, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("text-muted-foreground", title && "mt-1")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-muted animate-pulse rounded-lg", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
