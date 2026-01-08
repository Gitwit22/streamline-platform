import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function BillingSuccess() {
  const nav = useNavigate();

  useEffect(() => {
    // Simply return to billing; server webhooks will update state
    nav("/settings/billing", { replace: true });
  }, [nav]);

  return null;
}
