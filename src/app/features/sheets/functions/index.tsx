/**
 * Custom functions, built by clicking (no code): the builder dialog, the registry sync service and
 * demo content. Public through features/index.ts.
 */
import { lazy, Suspense } from "react";
import type { ID } from "../../../store/types";
import { useUI } from "../../../store/ui";

export { startCustomFunctions } from "./service";
export { demoFunctions, DEMO_MARGIN_ID } from "./demo";

/** Open the "Functions" dialog (on one function, or the list). */
export function openFunctionBuilder(id?: ID): void {
  useUI.getState().openModal({ type: "functions", id });
}

const LazyFunctionsModal = lazy(() => import("./FunctionsModal"));

/** The dialog (modal 'functions'; lazy-loaded). */
export function FunctionsModal(props: { initialId?: ID; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <LazyFunctionsModal {...props} />
    </Suspense>
  );
}
