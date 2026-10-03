import { SIGNUP_POSITIONS } from "@/lib/access-request";
import { RegisterForm } from "./register-form";

/** Ro'yxatdan o'tish: xodim ariza beradi, login Otdel kadr yoki direktor tasdiqlagach ochiladi. */
export default function RegisterPage() {
  return <RegisterForm positions={SIGNUP_POSITIONS} />;
}
