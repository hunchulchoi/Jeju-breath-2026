import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

export function TopBar({ badges }: { badges?: ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <Logo />
        <span>제주숨결봇</span>
      </Link>
      {badges ? <div className="badges">{badges}</div> : null}
    </header>
  );
}
