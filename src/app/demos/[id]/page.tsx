import { Suspense } from "react";
import { DemoView } from "@/components/demo-view";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6" aria-hidden>
          <div className="h-14 border-b border-border" />
          <div className="mt-4 h-24 border border-border bg-card" />
          <div className="mt-4 h-48 border border-border bg-muted" />
        </div>
      }
    >
      <DemoRoute params={params} />
    </Suspense>
  );
}

async function DemoRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DemoView key={id} id={id} />;
}
