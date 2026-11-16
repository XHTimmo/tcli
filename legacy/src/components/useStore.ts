import { useEffect, useState } from "react";
import { store } from "../stats.js";

export function useStore() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    store.on("change", f);
    return () => void store.off("change", f);
  }, []);
  return store;
}
