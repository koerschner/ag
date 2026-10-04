import { ICON, type IconName } from "../lib/icons";

// An icon from lib/icons (SVG strings shared with markdown HTML). display: contents, so the <svg> lays out as if
// it were the element's own child.
export function Icon({ name }: { name: IconName }) {
	return <i className="icon" dangerouslySetInnerHTML={{ __html: ICON[name] }} />;
}
