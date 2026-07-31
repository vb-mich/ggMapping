import { render } from "preact";

import { App } from "./ui/app";
import { applyTheme, theme } from "./state";
import { DISPLAY_NAME, STRINGS } from "./strings";
import "./updates"; // registers the service worker + the update prompt
import "./styles.css";

document.title = `${DISPLAY_NAME} — ${STRINGS.tagline}`;
applyTheme(theme.value); // dark by default, before first paint
render(<App />, document.getElementById("app")!);
