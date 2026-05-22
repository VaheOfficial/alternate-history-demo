import { useEffect, useState } from "react";
import { loadMapData } from "../../lib/map/loader";
import type { MapData } from "../../lib/map/types";

type State =
  | { status: "loading" }
  | { status: "ready"; data: MapData }
  | { status: "error"; message: string };

export function useMapData(): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadMapData()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
