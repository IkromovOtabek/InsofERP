"use client";

import { StepToggle } from "../otdel-kadr/hr3-forms";
import { myStepAction } from "./hr-actions";

/** Moslashuv qadami — xodimning o'zi yoki murabbiy belgilaydi. */
export function MyStep({ id, done, label }: { id: string; done: boolean; label: string }) {
  return <StepToggle id={id} done={done} label={label} run={myStepAction} />;
}
