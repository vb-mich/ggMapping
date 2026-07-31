import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { App } from "./ui/app";
import { DISPLAY_NAME, STRINGS } from "./strings";
import "./styles.css";

document.title = `${DISPLAY_NAME} — ${STRINGS.tagline}`;
registerSW({ immediate: true });
render(<App />, document.getElementById("app")!);
