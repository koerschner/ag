// The chat on screen, resolved from the route against the board (by session id, else tab).
import { refOf } from "../lib/format";
import type { Card } from "../lib/types";
import { useBoard, view } from "./board";
import { useUi, type Route } from "./ui";

export const resolve = (r: Route, v = view()): Card | undefined =>
	r.kind !== "chat" ? undefined : r.sid ? v.bySid.get(r.sid) : r.tab ? v.byTab.get(r.tab) : undefined;
export const currentCard = () => resolve(useUi.getState().route);
export const useCurrent = () => {
	const route = useUi((s) => s.route);
	return useBoard((s) => resolve(route, view(s)));
};
// The transcript ref the route shows: the live card's, or the session id's (a closed or asleep chat).
export const routeRef = (r: Route, c?: Card) => (c ? refOf(c) : r.kind === "chat" && r.sid ? `sid=${r.sid}` : null);
